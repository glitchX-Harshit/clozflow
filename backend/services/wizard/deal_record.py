"""Per-session deal record: methodology fields, objections, buying signals, risks, next step.

Updated incrementally from the coach's ``deal_record_delta`` (and the deterministic
moment detector), with evidence quotes and confidences; ``health()`` is
``contracts.compute_deal_health`` so the live number, the saved ``call_logs.deal_record``
and the debrief all agree. Cheap on purpose: every update is a few dict writes.
"""
from __future__ import annotations

import copy
import re
from typing import Optional

from services.wizard import contracts as C

STAGES = ("rapport", "discovery", "demo", "pricing", "objection", "next_steps", "close")
SEVERITIES = ("low", "medium", "high")
OBJECTION_TYPES = ("price", "timing", "authority", "need", "trust", "competitor", "status_quo", "integration",
                   "security_compliance", "brush_off", "india_specific", "other")
_EMPTY_VALUES = {"", "null", "none", "unknown", "n/a", "na", "not mentioned", "not discussed", "tbd", "-"}
_DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]20\d{2}|"
                      r"(?:mon|tues?|wednes|thurs?|fri|satur|sun)day|tomorrow|next week|"
                      r"\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b", re.I)


def _clean(value) -> Optional[str]:
    if value is None or isinstance(value, bool):
        return None
    text = " ".join(str(value).split())
    return None if text.lower() in _EMPTY_VALUES else text[:400]


class DealRecordTracker:
    def __init__(self, methodology: Optional[str]):
        self.record: C.DealRecord = C.empty_deal_record(methodology or "none")
        self.field_ids = [f["field"] for f in self.record["fields"]]
        self._last_health: Optional[C.DealHealth] = None
        self.version = 0

    # ── updates ──

    def apply_delta(self, delta: Optional[dict], *, turn_index: int, speaker: str = "prospect",
                    quote: Optional[str] = None, confidence: float = 0.6) -> bool:
        """Merge a ``deal_record_delta`` (flat or nested). Returns True when anything changed."""
        if not isinstance(delta, dict) or not delta:
            return False
        changed = False
        for key, raw in delta.items():
            if key in self.field_ids:
                changed |= self._set_field(key, raw, turn_index=turn_index, speaker=speaker, quote=quote, confidence=confidence)
            elif key in ("next_step", "next_step_text"):
                changed |= self._set_next_step(raw, delta.get("next_step_date") if key == "next_step_text" else None)
            elif key == "next_step_date":
                if "next_step_text" not in delta and "next_step" not in delta:
                    changed |= self._set_next_step(None, raw)
            elif key == "stage":
                stage = _clean(raw)
                if stage and stage.lower() in STAGES and self.record.get("stage") != stage.lower():
                    self.record["stage"] = stage.lower()
                    changed = True
            elif key in ("risk", "risk_text"):
                severity = raw.get("severity") if isinstance(raw, dict) else delta.get("risk_severity")
                text = raw.get("text") if isinstance(raw, dict) else raw
                changed |= self._add_risk(text, severity)
            elif key == "objection_resolved" and raw is True:
                changed |= self.resolve_open_objections(turn_index, how="Handled by the rep")
        if changed:
            self.version += 1
        return changed

    def _set_field(self, field_id: str, raw, *, turn_index, speaker, quote, confidence) -> bool:
        if isinstance(raw, dict):
            value = _clean(raw.get("value"))
            evidence = _clean(raw.get("evidence_quote") or raw.get("quote")) or quote
            conf = raw.get("confidence", confidence)
        else:
            value, evidence, conf = _clean(raw), quote, confidence
        if not value:
            return False
        try:
            conf = max(0.0, min(1.0, float(conf)))
        except (TypeError, ValueError):
            conf = float(confidence)
        for entry in self.record["fields"]:
            if entry["field"] != field_id:
                continue
            if entry.get("confirmed") is True:
                return False                  # the rep confirmed it; the model doesn't overwrite
            if entry.get("value") and (entry.get("confidence") or 0) > conf and entry["value"] != value:
                return False
            if entry.get("value") == value and (entry.get("confidence") or 0) >= conf:
                return False
            entry.update(value=value, evidence_quote=evidence, speaker=speaker, confidence=round(conf, 2),
                         turn_index=turn_index)
            return True
        return False

    def _set_next_step(self, text_raw, date_raw) -> bool:
        if isinstance(text_raw, dict):
            date_raw = text_raw.get("date", date_raw)
            text_raw = text_raw.get("text")
        text = _clean(text_raw)
        date = _clean(date_raw)
        if date and not _DATE_RE.search(date):
            text = text or date
            date = None
        if not text and not date:
            return False
        if text and not date:
            found = _DATE_RE.search(text)
            if found:
                date = found.group(0)
        current = self.record.get("next_step") or {}
        new = {"text": text or current.get("text"), "date": date or current.get("date")}
        if new == current:
            return False
        self.record["next_step"] = new
        return True

    def _add_risk(self, text_raw, severity_raw) -> bool:
        text = _clean(text_raw)
        if not text:
            return False
        severity = str(severity_raw or "medium").lower()
        if severity not in SEVERITIES:
            severity = "medium"
        for risk in self.record["risks"]:
            if risk["text"].lower() == text.lower():
                if SEVERITIES.index(severity) > SEVERITIES.index(risk["severity"]):
                    risk["severity"] = severity
                    return True
                return False
        self.record["risks"].append({"text": text, "severity": severity})
        return True

    def add_objection(self, objection: Optional[dict], *, turn_index: int, battlecard_id: Optional[str] = None) -> bool:
        if not isinstance(objection, dict):
            return False
        otype = _clean(objection.get("type")) or "other"
        otype = otype.lower().replace(" ", "_").replace("-", "_")
        if otype not in OBJECTION_TYPES:
            otype = "other"
        quote = _clean(objection.get("quote")) or ""
        for existing in self.record["objections"]:
            if existing["type"] == otype and not existing.get("handled") and turn_index - existing["turn_index"] <= 6:
                return False                  # the same open objection, still being discussed
        self.record["objections"].append({
            "type": otype, "quote": quote, "handled": bool(objection.get("handled")), "how": _clean(objection.get("how")),
            "battlecard_id": battlecard_id or objection.get("battlecard_id"), "turn_index": turn_index,
        })
        self.version += 1
        return True

    def open_objections(self) -> list[dict]:
        return [o for o in self.record["objections"] if not o.get("handled")]

    def resolve_open_objections(self, turn_index: int, how: Optional[str] = None) -> bool:
        changed = False
        for objection in self.record["objections"]:
            if not objection.get("handled") and turn_index >= objection["turn_index"]:
                objection["handled"] = True
                objection["how"] = how or objection.get("how")
                objection["handled_turn_index"] = turn_index
                changed = True
        if changed:
            self.version += 1
        return changed

    def add_buying_signal(self, signal: Optional[dict], *, turn_index: int) -> bool:
        if not isinstance(signal, dict):
            return False
        quote = _clean(signal.get("quote"))
        if not quote:
            return False
        if any(s["quote"].lower() == quote.lower() for s in self.record["buying_signals"]):
            return False
        self.record["buying_signals"].append({"quote": quote, "why": _clean(signal.get("why")), "turn_index": turn_index})
        self.version += 1
        return True

    # ── outputs ──

    def snapshot(self) -> C.DealRecord:
        return copy.deepcopy(self.record)

    def coverage(self) -> dict[str, bool]:
        return {f["field"]: bool(f.get("value")) for f in self.record["fields"]}

    def health(self, metrics: Optional[C.Metrics] = None) -> C.DealHealth:
        return C.compute_deal_health(self.record, metrics)

    def health_if_changed(self, metrics: Optional[C.Metrics] = None) -> Optional[C.DealHealth]:
        """The deal health when its score or rationale differs from the last one returned here."""
        current = self.health(metrics)
        if self._last_health is not None and current["score"] == self._last_health["score"] \
                and current["rationale"] == self._last_health["rationale"]:
            return None
        self._last_health = current
        return current
