"""Calendar sources for the Meeting Wizard: ICS fetch + RFC 5545 parsing, link detection,
and env-gated Google / Microsoft OAuth (spec §4 ``/calendar/*``).

ICS is the always-available path (Google "Secret address in iCal format", Outlook
"Publish calendar", Zoho, iCloud). Fetches are https-only, SSRF-checked through
``services.knowledge.url_safety``, capped at 2 MB and 10 s. The parser handles
folded lines, TZID/UTC/floating/all-day dates, DURATION, EXDATE, RECURRENCE-ID
overrides and ``RRULE`` FREQ=DAILY|WEEKLY (INTERVAL, COUNT, UNTIL, BYDAY); other
frequencies keep the first instance and are flagged in ``warnings`` (no
``dateutil`` dependency).
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode, urlsplit

import httpx

from services.knowledge import url_safety

logger = logging.getLogger(__name__)

ICS_MAX_BYTES = 2 * 1024 * 1024
ICS_TIMEOUT_S = 10.0
WINDOW_DAYS = 14
MAX_OCCURRENCES_PER_EVENT = 60
MAX_EVENTS = 500

PROVIDERS = ("google", "microsoft")

# ── conferencing link detection ──────────────────────────────────────────────

_LINK_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("meet", re.compile(r"https?://meet\.google\.com/[a-z0-9\-?=&_.]+", re.I)),
    ("zoom", re.compile(r"https?://[a-z0-9.\-]*zoom\.(?:us|com)/(?:j|my|w|s|wc)/[^\s<>\"']+", re.I)),
    ("teams", re.compile(r"https?://teams\.(?:microsoft\.com|live\.com)/[^\s<>\"']+", re.I)),
    ("other", re.compile(r"https?://[a-z0-9.\-]*(?:webex\.com|whereby\.com|gotomeet\.me|gotomeeting\.com)/[^\s<>\"']+", re.I)),
]


def detect_link(*texts: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """``(link, platform)`` from LOCATION / DESCRIPTION / X-GOOGLE-CONFERENCE style fields, in order."""
    for text in texts:
        if not text:
            continue
        for platform, pattern in _LINK_PATTERNS:
            match = pattern.search(text)
            if match:
                return match.group(0).rstrip(".,;)"), platform
    return None, None


# ── RFC 5545 parsing ─────────────────────────────────────────────────────────

def unfold(text: str) -> list[str]:
    """Join continuation lines (CRLF followed by a space or tab)."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        elif raw.strip() or lines:
            lines.append(raw)
    return lines


def _split_property(line: str) -> tuple[str, dict[str, str], str]:
    """``NAME;PARAM=VALUE;P2=V2:value`` → (NAME, {PARAM: VALUE}, value). Quoted params and ':' in values handled."""
    name_part, _, value = _partition_unquoted(line, ":")
    pieces = _split_unquoted(name_part, ";")
    name = pieces[0].upper()
    params: dict[str, str] = {}
    for piece in pieces[1:]:
        key, _, val = piece.partition("=")
        params[key.upper()] = val.strip('"')
    return name, params, value


def _partition_unquoted(text: str, sep: str) -> tuple[str, str, str]:
    quoted = False
    for index, char in enumerate(text):
        if char == '"':
            quoted = not quoted
        elif char == sep and not quoted:
            return text[:index], sep, text[index + 1:]
    return text, "", ""


def _split_unquoted(text: str, sep: str) -> list[str]:
    parts, current, quoted = [], [], False
    for char in text:
        if char == '"':
            quoted = not quoted
        if char == sep and not quoted:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return parts


def unescape_text(value: str) -> str:
    return (value.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",")
            .replace("\\;", ";").replace("\\\\", "\\")).strip()


def _tz(name: Optional[str]):
    if not name:
        return None
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 - unknown / Windows-style tz names
        return None


def parse_datetime(value: str, params: dict[str, str], warnings: list[str]) -> tuple[Optional[datetime], bool]:
    """ICS date or date-time → (naive UTC datetime, all_day). Floating times are treated as UTC."""
    value = value.strip()
    if not value:
        return None, False
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
        try:
            day = datetime.strptime(value[:8], "%Y%m%d")
        except ValueError:
            return None, False
        return day, True
    match = re.fullmatch(r"(\d{8})T(\d{6})(Z?)", value)
    if not match:
        return None, False
    try:
        naive = datetime.strptime(match.group(1) + match.group(2), "%Y%m%d%H%M%S")
    except ValueError:
        return None, False
    if match.group(3) == "Z":
        return naive, False
    tzid = params.get("TZID")
    if tzid:
        zone = _tz(tzid)
        if zone is None:
            warnings.append(f"Unknown time zone '{tzid}' treated as UTC.")
            return naive, False
        return naive.replace(tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None), False
    return naive, False


def parse_duration(value: str) -> Optional[timedelta]:
    match = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", value.strip())
    if not match:
        return None
    sign = -1 if match.group(1) == "-" else 1
    weeks, days, hours, minutes, seconds = (int(g) if g else 0 for g in match.groups()[1:])
    return sign * timedelta(weeks=weeks, days=days, hours=hours, minutes=minutes, seconds=seconds)


_WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def expand_rrule(rrule: str, start: datetime, window_start: datetime, window_end: datetime,
                 warnings: list[str]) -> Optional[list[datetime]]:
    """Occurrence starts within the window for FREQ=DAILY|WEEKLY; None when unsupported."""
    rule = {}
    for part in rrule.split(";"):
        key, _, val = part.partition("=")
        if key:
            rule[key.strip().upper()] = val.strip()
    freq = rule.get("FREQ", "").upper()
    if freq not in ("DAILY", "WEEKLY"):
        warnings.append(f"RRULE FREQ={freq or '?'} is not expanded; only the first instance is shown.")
        return None
    try:
        interval = max(1, int(rule.get("INTERVAL", "1")))
    except ValueError:
        interval = 1
    count = None
    if rule.get("COUNT"):
        try:
            count = max(1, int(rule["COUNT"]))
        except ValueError:
            count = None
    until = None
    if rule.get("UNTIL"):
        until, _ = parse_datetime(rule["UNTIL"], {}, warnings)
        if until is not None and len(rule["UNTIL"]) == 8:
            until = until + timedelta(days=1) - timedelta(seconds=1)
    by_days = [d for d in rule.get("BYDAY", "").split(",") if d]
    weekday_set = {_WEEKDAYS[d[-2:]] for d in by_days if d[-2:] in _WEEKDAYS} or {start.weekday()}

    occurrences: list[datetime] = []
    produced = 0
    if freq == "DAILY":
        current = start
        steps = 0
        while steps < 5000:
            if until and current > until:
                break
            if count is not None and produced >= count:
                break
            produced += 1
            if window_start <= current <= window_end:
                occurrences.append(current)
                if len(occurrences) >= MAX_OCCURRENCES_PER_EVENT:
                    break
            if current > window_end:
                break
            current += timedelta(days=interval)
            steps += 1
        return occurrences
    # WEEKLY: iterate week by week from the week of `start`, emitting selected weekdays.
    week_anchor = start - timedelta(days=start.weekday())
    weeks = 0
    while weeks < 1000:
        week_start = week_anchor + timedelta(weeks=weeks * interval)
        if week_start > window_end + timedelta(days=7):
            break
        for weekday in sorted(weekday_set):
            current = week_start + timedelta(days=weekday)
            current = current.replace(hour=start.hour, minute=start.minute, second=start.second)
            if current < start:
                continue
            if until and current > until:
                return occurrences
            if count is not None and produced >= count:
                return occurrences
            produced += 1
            if window_start <= current <= window_end:
                occurrences.append(current)
                if len(occurrences) >= MAX_OCCURRENCES_PER_EVENT:
                    return occurrences
        weeks += 1
    return occurrences


def _parse_attendee(params: dict[str, str], value: str) -> Optional[dict]:
    email = value.strip()
    if email.lower().startswith("mailto:"):
        email = email[7:]
    name = params.get("CN") or ""
    if params.get("CUTYPE", "INDIVIDUAL").upper() not in ("INDIVIDUAL", ""):
        return None
    if not email and not name:
        return None
    return {"name": name.strip() or email.split("@")[0], "email": email.strip() or None}


def parse_ics(text: str, *, window_start: datetime, window_end: datetime) -> dict:
    """``{"events": [...], "warnings": [...]}`` for VEVENTs that start inside the window (naive UTC)."""
    warnings: list[str] = []
    events: list[dict] = []
    overrides: set[tuple[str, str]] = set()
    raw_events: list[dict] = []
    current: Optional[dict] = None
    for line in unfold(text):
        if not line.strip():
            continue
        name, params, value = _split_property(line)
        if name == "BEGIN" and value.upper() == "VEVENT":
            current = {"props": [], "exdates": []}
            continue
        if name == "END" and value.upper() == "VEVENT":
            if current is not None:
                raw_events.append(current)
            current = None
            continue
        if current is None:
            continue
        if name == "EXDATE":
            for piece in value.split(","):
                when, _ = parse_datetime(piece, params, warnings)
                if when:
                    current["exdates"].append(when)
            continue
        current["props"].append((name, params, value))

    def prop(ev: dict, key: str) -> tuple[dict[str, str], str]:
        for name, params, value in ev["props"]:
            if name == key:
                return params, value
        return {}, ""

    for ev in raw_events:
        _, uid = prop(ev, "UID")
        rid_params, rid = prop(ev, "RECURRENCE-ID")
        if rid:
            when, _ = parse_datetime(rid, rid_params, warnings)
            if when and uid:
                overrides.add((uid, when.isoformat()))

    for ev in raw_events:
        if len(events) >= MAX_EVENTS:
            warnings.append(f"More than {MAX_EVENTS} events; the rest were ignored.")
            break
        _, status = prop(ev, "STATUS")
        if status.strip().upper() == "CANCELLED":
            continue
        _, uid = prop(ev, "UID")
        uid = uid.strip() or hashlib.sha1(repr(ev["props"]).encode("utf-8")).hexdigest()[:24]
        start_params, start_raw = prop(ev, "DTSTART")
        start, all_day = parse_datetime(start_raw, start_params, warnings)
        if start is None:
            continue
        end_params, end_raw = prop(ev, "DTEND")
        end, _ = parse_datetime(end_raw, end_params, warnings) if end_raw else (None, False)
        if end is None:
            _, dur_raw = prop(ev, "DURATION")
            duration = parse_duration(dur_raw) if dur_raw else None
            end = start + (duration or (timedelta(days=1) if all_day else timedelta(hours=1)))
        length = end - start
        _, summary = prop(ev, "SUMMARY")
        _, description = prop(ev, "DESCRIPTION")
        _, location = prop(ev, "LOCATION")
        _, conference = prop(ev, "X-GOOGLE-CONFERENCE")
        _, url_prop = prop(ev, "URL")
        _, organizer = prop(ev, "ORGANIZER")
        summary, description, location = unescape_text(summary), unescape_text(description), unescape_text(location)
        link, platform = detect_link(conference, location, description, url_prop)
        if platform is None:
            platform = "in_person" if location and not re.match(r"https?://", location) else ("other" if link else None)
        attendees = []
        for name, params, value in ev["props"]:
            if name == "ATTENDEE":
                attendee = _parse_attendee(params, value)
                if attendee:
                    attendees.append(attendee)
        _, rrule = prop(ev, "RRULE")
        rid_params, rid = prop(ev, "RECURRENCE-ID")
        base = {
            "uid": uid, "title": summary or "(no title)", "description": description[:2000], "location": location[:500],
            "attendees": attendees[:50], "organizer": organizer.replace("mailto:", "").replace("MAILTO:", "") or None,
            "meeting_link": link, "platform": platform, "all_day": all_day, "recurring": bool(rrule),
        }
        starts: list[datetime]
        if rrule and not rid:
            expanded = expand_rrule(rrule, start, window_start, window_end, warnings)
            starts = expanded if expanded is not None else ([start] if window_start <= start <= window_end else [])
            starts = [s for s in starts if s not in ev["exdates"] and (uid, s.isoformat()) not in overrides]
        else:
            starts = [start] if window_start <= start <= window_end else []
        for occurrence in starts:
            external_id = uid if (not rrule or rid) else f"{uid}@{occurrence.strftime('%Y%m%dT%H%M%S')}"
            if rid:
                external_id = uid + "@" + (parse_datetime(rid, rid_params, warnings)[0] or occurrence).strftime("%Y%m%dT%H%M%S")
            payload = {**base, "external_id": external_id[:300], "start": occurrence, "end": occurrence + length}
            payload["raw_hash"] = hashlib.sha1(
                "|".join([payload["title"], payload["start"].isoformat(), payload["end"].isoformat(),
                          payload["meeting_link"] or "", payload["location"], str(payload["attendees"])]).encode("utf-8")
            ).hexdigest()
            events.append(payload)
    events.sort(key=lambda e: e["start"])
    return {"events": events, "warnings": list(dict.fromkeys(warnings))}


# ── ICS fetching (https only, SSRF-checked, size/time capped) ────────────────

class CalendarFetchError(RuntimeError):
    """Human-readable fetch problem (shown to the user)."""


def normalize_ics_url(url: str) -> str:
    raw = (url or "").strip()
    if raw.lower().startswith("webcal://"):
        raw = "https://" + raw[len("webcal://"):]
    try:
        normalized = url_safety.normalize_url(raw)
    except url_safety.UnsafeURLError as exc:
        raise CalendarFetchError(str(exc))
    if urlsplit(normalized).scheme != "https":
        raise CalendarFetchError("Calendar links must use https://.")
    return normalized


def mask_ics_url(url: Optional[str]) -> Optional[str]:
    """Hide the secret part of a private ICS link in API responses."""
    if not url:
        return None
    parts = urlsplit(url)
    path = parts.path
    tail = path.rsplit("/", 1)[-1]
    masked_path = path if len(path) <= 24 else path[:12] + "…/" + tail[-12:]
    return f"{parts.scheme}://{parts.netloc}{masked_path}"


async def fetch_ics(url: str) -> str:
    """Download an ICS feed with the knowledge crawler's SSRF-safe client."""
    normalized = normalize_ics_url(url)
    try:
        await url_safety.validate_public_url(normalized)
    except url_safety.UnsafeURLError as exc:
        raise CalendarFetchError(str(exc))
    client = url_safety.safe_async_client(timeout=ICS_TIMEOUT_S, headers={"User-Agent": "ClozFlow-Calendar/1.0", "Accept": "text/calendar, */*"})
    try:
        async with client:
            response, body, truncated = await url_safety.fetch_limited(
                client, normalized, max_bytes=ICS_MAX_BYTES, deadline_seconds=ICS_TIMEOUT_S)
    except url_safety.UnsafeURLError as exc:
        raise CalendarFetchError(str(exc))
    except httpx.HTTPError as exc:
        raise CalendarFetchError(f"Couldn't reach the calendar ({type(exc).__name__}). Check the link and try again.")
    except TimeoutError:
        raise CalendarFetchError("The calendar took too long to respond (10 s). Try again in a minute.")
    if response.status_code >= 400:
        raise CalendarFetchError(f"The calendar link returned HTTP {response.status_code}. Re-copy the private address from your calendar settings.")
    if truncated:
        raise CalendarFetchError("This calendar feed is larger than 2 MB. Share a calendar with fewer events.")
    text = url_safety.decode_body(response, body)
    if "BEGIN:VCALENDAR" not in text[:4096]:
        raise CalendarFetchError("That link didn't return a calendar (.ics) file. Use the private iCal / ICS address.")
    return text


def window(now: Optional[datetime] = None, days: int = WINDOW_DAYS) -> tuple[datetime, datetime]:
    now = now or datetime.utcnow()
    return now - timedelta(days=days), now + timedelta(days=days)


# ── Google / Microsoft OAuth (env-gated) ─────────────────────────────────────

UNCONFIGURED_MESSAGES = {
    "google": "Google Calendar isn't configured on this server. Paste your calendar's private ICS link instead.",
    "microsoft": "Microsoft 365 calendar isn't configured on this server. Paste your calendar's published ICS link instead.",
}

_PROVIDER_META = {
    "google": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scope": "https://www.googleapis.com/auth/calendar.events.readonly",
        "client_id_env": "GOOGLE_CALENDAR_CLIENT_ID",
        "client_secret_env": "GOOGLE_CALENDAR_CLIENT_SECRET",
    },
    "microsoft": {
        "auth_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scope": "offline_access Calendars.ReadBasic",
        "client_id_env": "MS_GRAPH_CLIENT_ID",
        "client_secret_env": "MS_GRAPH_CLIENT_SECRET",
    },
}


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def oauth_redirect_base() -> str:
    return (_env("CLOZFLOW_WIZARD_OAUTH_REDIRECT_BASE") or "http://localhost:8000").rstrip("/")


def provider_config(provider: str) -> Optional[dict]:
    meta = _PROVIDER_META.get(provider)
    if not meta:
        return None
    client_id, client_secret = _env(meta["client_id_env"]), _env(meta["client_secret_env"])
    if not client_id or not client_secret:
        return None
    return {**meta, "client_id": client_id, "client_secret": client_secret,
            "redirect_uri": f"{oauth_redirect_base()}/api/wizard/calendar/oauth/{provider}/callback"}


def build_auth_url(provider: str, state: str) -> str:
    config = provider_config(provider)
    if not config:
        raise LookupError(UNCONFIGURED_MESSAGES.get(provider, "Calendar provider not configured."))
    params = {"client_id": config["client_id"], "redirect_uri": config["redirect_uri"], "response_type": "code",
              "scope": config["scope"], "state": state}
    if provider == "google":
        params.update({"access_type": "offline", "prompt": "consent"})
    else:
        params.update({"response_mode": "query"})
    return config["auth_url"] + "?" + urlencode(params)


def _http_client() -> httpx.AsyncClient:
    """Outbound client for provider APIs (patched in tests)."""
    return httpx.AsyncClient(timeout=15.0, trust_env=False)


async def exchange_code(provider: str, code: str) -> dict:
    config = provider_config(provider)
    if not config:
        raise LookupError(UNCONFIGURED_MESSAGES.get(provider, "Calendar provider not configured."))
    data = {"client_id": config["client_id"], "client_secret": config["client_secret"], "code": code,
            "grant_type": "authorization_code", "redirect_uri": config["redirect_uri"]}
    if provider == "microsoft":
        data["scope"] = config["scope"]
    async with _http_client() as client:
        response = await client.post(config["token_url"], data=data)
    if response.status_code >= 400:
        raise CalendarFetchError(f"{provider.title()} rejected the sign-in (HTTP {response.status_code}). Try connecting again.")
    tokens = response.json()
    tokens["obtained_at"] = datetime.utcnow().isoformat() + "Z"
    return tokens


async def refresh_tokens(provider: str, tokens: dict) -> dict:
    config = provider_config(provider)
    refresh = (tokens or {}).get("refresh_token")
    if not config or not refresh:
        raise CalendarFetchError(f"{provider.title()} calendar needs to be reconnected.")
    data = {"client_id": config["client_id"], "client_secret": config["client_secret"],
            "refresh_token": refresh, "grant_type": "refresh_token"}
    if provider == "microsoft":
        data["scope"] = config["scope"]
    async with _http_client() as client:
        response = await client.post(config["token_url"], data=data)
    if response.status_code >= 400:
        raise CalendarFetchError(f"{provider.title()} calendar needs to be reconnected.")
    fresh = response.json()
    merged = {**tokens, **fresh, "obtained_at": datetime.utcnow().isoformat() + "Z"}
    merged.setdefault("refresh_token", refresh)
    return merged


def _token_expired(tokens: dict) -> bool:
    try:
        obtained = datetime.fromisoformat((tokens.get("obtained_at") or "").rstrip("Z"))
        ttl = int(tokens.get("expires_in") or 3600)
    except (TypeError, ValueError):
        return True
    return datetime.utcnow() >= obtained + timedelta(seconds=max(60, ttl - 60))


def _iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, dict):
        value = value.get("dateTime") or value.get("date")
    if not isinstance(value, str):
        return None
    raw = value.strip()
    try:
        if len(raw) == 10:
            return datetime.strptime(raw, "%Y-%m-%d")
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        raw = re.sub(r"\.(\d{6})\d+", r".\1", raw)   # Graph sends 7 fractional digits
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _map_google_event(item: dict) -> Optional[dict]:
    start, end = _iso(item.get("start")), _iso(item.get("end"))
    if not start or item.get("status") == "cancelled":
        return None
    attendees = [{"name": a.get("displayName") or (a.get("email") or "").split("@")[0], "email": a.get("email")}
                 for a in item.get("attendees") or [] if not a.get("resource")]
    conference_uris = " ".join(ep.get("uri", "") for ep in (item.get("conferenceData") or {}).get("entryPoints", []))
    link, platform = detect_link(item.get("hangoutLink"), conference_uris, item.get("location"), item.get("description"))
    return {"external_id": item.get("id"), "title": item.get("summary") or "(no title)", "start": start,
            "end": end or start + timedelta(hours=1), "attendees": attendees, "meeting_link": link,
            "platform": platform or ("in_person" if item.get("location") else None), "location": item.get("location"),
            "organizer": (item.get("organizer") or {}).get("email"),
            "raw_hash": hashlib.sha1(repr(item.get("updated") or item).encode("utf-8")).hexdigest()}


def _map_graph_event(item: dict) -> Optional[dict]:
    if item.get("isCancelled"):
        return None
    start, end = _iso(item.get("start")), _iso(item.get("end"))
    if not start:
        return None
    attendees = []
    for a in item.get("attendees") or []:
        address = (a.get("emailAddress") or {})
        attendees.append({"name": address.get("name") or (address.get("address") or "").split("@")[0], "email": address.get("address")})
    join = (item.get("onlineMeeting") or {}).get("joinUrl") or item.get("onlineMeetingUrl")
    location = ((item.get("location") or {}).get("displayName")) or None
    link, platform = detect_link(join, location, item.get("bodyPreview"))
    if not link and join:
        link, platform = join, "teams" if item.get("onlineMeetingProvider") == "teamsForBusiness" else "other"
    return {"external_id": item.get("iCalUId") or item.get("id"), "title": item.get("subject") or "(no title)",
            "start": start, "end": end or start + timedelta(hours=1), "attendees": attendees, "meeting_link": link,
            "platform": platform or ("in_person" if location else None), "location": location,
            "organizer": ((item.get("organizer") or {}).get("emailAddress") or {}).get("address"),
            "raw_hash": hashlib.sha1(repr(item.get("lastModifiedDateTime") or item).encode("utf-8")).hexdigest()}


async def fetch_provider_events(provider: str, tokens: dict, window_start: datetime, window_end: datetime) -> tuple[list[dict], dict]:
    """Events from Google Calendar / Microsoft Graph in the window; returns (events, possibly-refreshed tokens)."""
    if _token_expired(tokens):
        tokens = await refresh_tokens(provider, tokens)
    headers = {"Authorization": f"Bearer {tokens.get('access_token', '')}"}
    start_iso, end_iso = window_start.isoformat() + "Z", window_end.isoformat() + "Z"
    if provider == "google":
        url = ("https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
               urlencode({"timeMin": start_iso, "timeMax": end_iso, "singleEvents": "true", "orderBy": "startTime", "maxResults": 250}))
        mapper, items_key = _map_google_event, "items"
    else:
        url = ("https://graph.microsoft.com/v1.0/me/calendarView?" +
               urlencode({"startDateTime": start_iso, "endDateTime": end_iso, "$top": 250}))
        headers["Prefer"] = 'outlook.timezone="UTC"'
        mapper, items_key = _map_graph_event, "value"
    async with _http_client() as client:
        response = await client.get(url, headers=headers)
        if response.status_code == 401:
            tokens = await refresh_tokens(provider, tokens)
            headers["Authorization"] = f"Bearer {tokens.get('access_token', '')}"
            response = await client.get(url, headers=headers)
    if response.status_code >= 400:
        raise CalendarFetchError(f"{provider.title()} calendar returned HTTP {response.status_code}. Try reconnecting the calendar.")
    items = response.json().get(items_key) or []
    events = [e for e in (mapper(item) for item in items[:MAX_EVENTS]) if e]
    return events, tokens
