import os
import re
import time
import asyncio
from typing import List, Dict, Any, Optional, Set, Callable
from urllib.parse import urlparse, urljoin
import xml.etree.ElementTree as ET

import httpx
from bs4 import BeautifulSoup


# ── SSRF Security Guard ───────────────────────────────────────────────────────
# All URL validation and the connect-time IP check live in url_safety; the
# names below are re-exported for existing imports.

from services.knowledge.url_safety import (  # noqa: E402,F401
    BLOCKED_HOSTNAMES,
    UnsafeURLError,
    allow_private_targets,
    decode_body,
    fetch_limited,
    normalize_url,
    safe_async_client,
    validate_url_security,
    validate_url_security_async,
)

ALLOW_LOCALHOST_CRAWL = allow_private_targets()

# Crawl limits (pages / bytes / time / frontier).
MAX_PAGES_HARD_CAP = 50
MAX_PAGE_BYTES = int(os.getenv("CRAWL_MAX_PAGE_BYTES", str(3 * 1024 * 1024)))
PAGE_DEADLINE_SECONDS = float(os.getenv("CRAWL_PAGE_DEADLINE_SECONDS", "20"))
MAX_CRAWL_SECONDS = float(os.getenv("CRAWL_MAX_SECONDS", "150"))
MAX_FRONTIER = 300
MAX_SITEMAP_URLS = 500


def _same_site(host: str, base_host: str) -> bool:
    host = (host or "").lower()
    base_host = (base_host or "").lower()
    return bool(host) and host.removeprefix("www.") == base_host.removeprefix("www.")


# ── Page Priority Categorization ─────────────────────────────────────────────

# ── Universal Page Priority & Semantic Slug Categorization ────────────────────

SEMANTIC_CATEGORIES = [
    # 1. Commercial / Pricing / Plans / Rates / Retainers
    (
        r"(pricing|prices|price|plans|plan|cost|costs|tiers|tier|rates|rate|fees|fee|quote|packages|package|membership|memberships|investment|retainer|billing)",
        105,
        "pricing"
    ),
    # 2. How it works / Methodology / Process / Architecture / Why Us
    (
        r"(how-it-works|howitworks|how_it_works|how-we-work|howwework|our-process|process|methodology|approach|architecture|technology|why-us|whyus|why_us|why-choose-us)",
        95,
        "how_it_works"
    ),
    # 3. Product / Services / Catalog / Deliverables / Menu / Treatments
    (
        r"(product|products|platform|feature|features|capability|capabilities|service|services|offering|offerings|solution|solutions|deliverable|deliverables|menu|treatment|treatments|what-we-do|whatwedo|specialties)",
        90,
        "product"
    ),
    # 4. Portfolio / Works / Case Studies / Selected Projects / Showcase
    (
        r"(portfolio|projects|project|case-studies|casestudies|case-study|casestudy|works|work|our-work|ourwork|selected-work|selected-works|showcase|creations|gallery|clients|customers|success-stories)",
        85,
        "portfolio"
    ),
    # 5. Reviews / Testimonials / Social Proof / Results / Awards
    (
        r"(testimonial|testimonials|reviews|review|praise|results|wall-of-love|awards|recognitions)",
        75,
        "case_study"
    ),
    # 6. About / Company / Philosophy / Founder / Team / Story
    (
        r"(about|about-us|aboutus|about_us|company|who-we-are|whoweare|our-story|ourstory|story|mission|philosophy|values|team|founders|leadership|bio|agency|studio)",
        70,
        "about"
    ),
    # 7. FAQ / Questions / Help / Knowledge Base / Q&A
    (
        r"(faq|faqs|frequently-asked-questions|q-and-a|qna|questions|help|knowledge-base|support|answers)",
        65,
        "faq"
    ),
    # 8. Terms / Policies / Guarantees / SLAs / Compliance / Legal
    (
        r"(terms|term|terms-of-service|termsofservice|terms-and-conditions|termsandconditions|tos|privacy|privacy-policy|privacypolicy|refund|refund-policy|guarantee|warranty|sla|compliance|security|legal)",
        60,
        "terms"
    ),
    # 9. Contact / Consultation / Demo / Booking / Locations
    (
        r"(contact|contact-us|contactus|get-in-touch|book|booking|schedule|consultation|inquiry|demo|reach-us|locations|location)",
        55,
        "contact"
    ),
    # 10. Docs / Guides / Resources / Whitepaper
    (
        r"(docs|documentation|guides|guide|resources|resource|whitepaper|api)",
        50,
        "documentation"
    ),
    # 11. Blog / News / Insights / Press
    (
        r"(blog|posts|post|articles|article|insights|news|press|journal|stories)",
        40,
        "blog"
    ),
]

def score_page_priority(path: str, anchor_text: str = "") -> tuple[int, str]:
    """
    Evaluates page value using semantic URL slug matching, hyphen/underscore normalization,
    and HTML anchor text context. Universal across SaaS, portfolios, agencies, clinics, and e-commerce.
    """
    p = path.lower()
    text = anchor_text.lower().strip() if anchor_text else ""
    combined = f"{p} {text}".strip()

    if p in ("/", "", "/index.html", "/home", "/index"):
        return 120, "homepage"

    # Normalize separators: e.g. "how_it_works", "how-it-works", "howitworks"
    clean_combined = re.sub(r"[\-_\/]+", " ", combined)

    for pattern, score, p_type in SEMANTIC_CATEGORIES:
        if re.search(pattern, combined) or re.search(pattern, clean_combined):
            return score, p_type

    return 30, "general"


def classify_page_by_content(clean_text: str, title: str, fallback_type: str = "general") -> str:
    """
    Autonomously classifies a page based on its actual textual content,
    structural patterns, and currency/data signals rather than relying solely on the URL.
    Works universally across obscure URLs (e.g. /p/102, /x/node, /view?id=4).
    """
    text_lower = clean_text.lower()[:5000]
    title_lower = title.lower()
    combined = f"{title_lower} {text_lower}"

    # 1. Commercial / Pricing Signals: Currency symbols, plan terms, billing cadences
    if re.search(r"[\$₹€£]\s*\d+", combined) or any(k in title_lower for k in ["pricing", "plans", "cost", "rates", "retainer", "quote"]):
        return "pricing"

    # 2. How it works / Process / Methodology
    if any(k in combined for k in ["how it works", "our process", "step 1", "how we work", "the process", "methodology", "architecture"]):
        return "how_it_works"

    # 3. Portfolio / Case Studies / Project Showcase
    if any(k in combined for k in ["case study", "case studies", "selected works", "featured projects", "client:", "deliverables:", "our work", "flagship project"]):
        return "portfolio"

    # 4. FAQ / Q&A
    if ("frequently asked" in combined or "faq" in title_lower) or (text_lower.count("?") >= 4 and any(q in text_lower for q in ["how do i", "can i", "what is", "how does"])):
        return "faq"

    # 5. Terms / Policies / SLAs
    if any(k in combined for k in ["terms of service", "terms and conditions", "privacy policy", "governing law", "refund policy", "service level agreement"]):
        return "terms"

    # 6. About / Company Profile
    if any(k in combined for k in ["about us", "who we are", "our story", "our mission", "meet the team", "leadership team"]):
        return "about"

    # Retain priority-scored type if already determined, or fallback
    return fallback_type if fallback_type != "general" else "general"


# ── HTML Sanitizer & Content Extractor ───────────────────────────────────────

BOILERPLATE_SELECTORS = [
    "nav", "header", "footer", "aside", "script", "style", "noscript",
    "svg", "iframe", "form", ".nav", ".navbar", ".footer", ".sidebar",
    ".cookie-banner", ".cookie-consent", "#cookie-notice", ".modal",
    ".popup", ".advertisement", ".ad", ".social-share", "#disclaimer"
]

def extract_clean_page_content(html: str, url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")

    # Extract title
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    elif soup.find("h1"):
        title = soup.find("h1").get_text(strip=True)

    # Extract meta description
    meta_desc = ""
    desc_tag = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    if desc_tag and desc_tag.get("content"):
        meta_desc = desc_tag["content"].strip()

    # Remove boilerplate elements
    for selector in BOILERPLATE_SELECTORS:
        for tag in soup.select(selector):
            tag.decompose()

    # Extract text with meaningful structure
    lines = []
    if meta_desc:
        lines.append(f"Summary: {meta_desc}\n")

    # Headings and paragraphs
    for el in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "dt", "dd"]):
        text = el.get_text(separator=" ", strip=True)
        if len(text) > 8:
            tag_name = el.name.lower()
            if tag_name in ("h1", "h2", "h3"):
                lines.append(f"\n### {text}\n")
            elif tag_name == "li":
                lines.append(f"- {text}")
            else:
                lines.append(text)

    clean_text = "\n".join(lines)
    # Deduplicate excessive blank lines
    clean_text = re.sub(r"\n{3,}", "\n\n", clean_text).strip()

    # Discover same-origin links
    discovered_links = set()
    parsed_base = urlparse(url)
    base_domain = parsed_base.netloc.lower()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        full_url = urljoin(url, href)
        parsed_link = urlparse(full_url)
        # Same domain check (or www vs non-www)
        link_domain = parsed_link.netloc.lower()
        if link_domain == base_domain or link_domain.replace("www.", "") == base_domain.replace("www.", ""):
            # Strip anchors and parameters that don't change content
            clean_link = f"{parsed_link.scheme}://{parsed_link.netloc}{parsed_link.path}"
            # Exclude asset directories, cdn, media, wp-content
            if re.search(r"/(assets|static|cdn|media|images|img|uploads|wp-content|wp-includes)/", clean_link, re.I):
                continue
            # Exclude media, pdfs, images, login, admin
            if not re.search(r"\.(png|jpg|jpeg|gif|webp|svg|css|js|ico|woff|woff2|ttf|eot|mp4|mp3|wav|ogg|zip|pdf)$", clean_link, re.I):
                if not re.search(r"/(login|signin|signup|register|auth|admin|wp-admin|cart|checkout)/?", clean_link, re.I):
                    discovered_links.add(clean_link)

    return {
        "title": title or "Untitled Page",
        "clean_text": clean_text,
        "meta_description": meta_desc,
        "internal_links": list(discovered_links)
    }


def extract_markdown_internal_links(base_url: str, text: str) -> List[str]:
    """
    Extracts high-value internal page links from rendered DOM markdown,
    resolving relative links and excluding static asset directories.
    """
    parsed_base = urlparse(base_url)
    base_domain = parsed_base.netloc.lower().replace("www.", "")

    # 1. Full absolute URLs matching base domain
    # The host must end right after base_domain (no "example.com.evil.net").
    raw_abs = re.findall(rf"https?://(?:www\.)?{re.escape(base_domain)}(?:[/?#][a-zA-Z0-9_\-\/\.\?\=\#]*)?(?![a-zA-Z0-9.\-])", text)
    # 2. Markdown relative paths [text](/path)
    raw_rel = re.findall(r"\]\((/[a-zA-Z0-9_\-\/]+)\)", text)

    combined = set()
    for u in raw_abs:
        combined.add(u.split("#")[0].split("?")[0].rstrip("/"))
    for r in raw_rel:
        combined.add(urljoin(base_url, r).split("#")[0].split("?")[0].rstrip("/"))

    filtered = []
    for link in combined:
        p = urlparse(link).path.lower()
        if re.search(r"\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|eot|mp4|mp3|wav|ogg|zip|tar|gz|pdf)$", p):
            continue
        if re.search(r"/(assets|static|cdn|media|images|img|uploads|wp-content|wp-includes)/", p):
            continue
        if re.search(r"/(login|signin|signup|register|auth|admin|cart|checkout)/?", p):
            continue
        filtered.append(link)
    return filtered


# ── Production Website Crawler ───────────────────────────────────────────────

class WebsiteCrawler:
    """Bounded, SSRF-guarded crawler.

    Every request (pages, sitemaps, reader fallback, each redirect hop) goes
    through ``url_safety.safe_async_client``, which validates the resolved IP
    at connect time. Limits: ``max_pages`` pages, ``max_page_bytes`` per
    response body, ``page_deadline_seconds`` per fetch, ``max_total_seconds``
    for the whole crawl, and a bounded frontier.
    """

    def __init__(
        self,
        base_url: str,
        max_pages: int = 18,
        max_depth: int = 2,
        request_timeout: float = 12.0,
        event_callback: Optional[Callable[[Dict[str, Any]], Any]] = None,
        max_total_seconds: float = MAX_CRAWL_SECONDS,
        max_page_bytes: int = MAX_PAGE_BYTES,
        page_deadline_seconds: float = PAGE_DEADLINE_SECONDS,
        network_backend=None,
    ):
        self.base_url = base_url
        self.max_pages = max(1, min(int(max_pages), MAX_PAGES_HARD_CAP))
        self.max_depth = max_depth
        self.timeout = request_timeout
        self.event_callback = event_callback
        self.max_total_seconds = max_total_seconds
        self.max_page_bytes = max_page_bytes
        self.page_deadline_seconds = page_deadline_seconds
        self._network_backend = network_backend
        self.visited: Set[str] = set()
        self.results: List[Dict[str, Any]] = []
        self._started = 0.0

    def _time_left(self) -> float:
        return self.max_total_seconds - (time.monotonic() - self._started)

    async def _emit_event(self, event_type: str, data: Dict[str, Any]):
        if self.event_callback:
            try:
                res = self.event_callback({"type": event_type, **data})
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                print(f"[Crawler Event Error] {type(e).__name__}")

    async def _get(self, client: httpx.AsyncClient, url: str, headers: Optional[dict] = None, deadline: Optional[float] = None):
        """(response, text, truncated) with size and time caps."""
        deadline = min(deadline or self.page_deadline_seconds, max(1.0, self._time_left()))
        response, body, truncated = await fetch_limited(
            client, url, max_bytes=self.max_page_bytes, deadline_seconds=deadline, headers=headers
        )
        return response, decode_body(response, body), truncated

    async def _discover_sitemap_urls(self, client: httpx.AsyncClient) -> List[str]:
        """Attempt to read sitemap.xml for high-priority pages."""
        parsed = urlparse(self.base_url)
        base_host = (parsed.hostname or "").lower()
        sitemap_candidates = [
            f"{parsed.scheme}://{parsed.netloc}/sitemap.xml",
            f"{parsed.scheme}://{parsed.netloc}/sitemap_index.xml",
            f"{parsed.scheme}://{parsed.netloc}/sitemap_products_1.xml",
            f"{parsed.scheme}://{parsed.netloc}/sitemap-products.xml",
            f"{parsed.scheme}://{parsed.netloc}/sitemap-pages.xml",
        ]
        urls_found = []
        for s_url in sitemap_candidates:
            if self._time_left() <= 0:
                break
            try:
                resp, text, truncated = await self._get(client, s_url, deadline=6.0)
                if resp.status_code == 200 and "xml" in resp.headers.get("content-type", "") and not truncated:
                    root = ET.fromstring(text)
                    # Namespace-agnostic tag check
                    for elem in root.iter():
                        if elem.tag.endswith("loc") and elem.text:
                            loc = elem.text.strip()
                            loc_host = (urlparse(loc).hostname or "").lower()
                            if loc.startswith("http") and _same_site(loc_host, base_host):
                                urls_found.append(loc)
                                if len(urls_found) >= MAX_SITEMAP_URLS:
                                    break
                if urls_found:
                    break
            except UnsafeURLError:
                break
            except Exception:
                pass
        return urls_found

    async def crawl(self) -> List[Dict[str, Any]]:
        is_safe, norm_url = await validate_url_security_async(self.base_url)
        if not is_safe:
            raise ValueError(f"Security validation failed: {norm_url}")

        self._started = time.monotonic()
        self.base_url = norm_url

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        # Queue of tuples: (score, depth, url)
        # Higher score popped first
        frontier: List[tuple[int, int, str]] = []
        frontier.append((120, 0, self.base_url))

        await self._emit_event("connecting", {"url": self.base_url, "message": "Connecting to website..."})

        async with safe_async_client(timeout=self.timeout, headers=headers, network_backend=self._network_backend) as client:
            # 1. Discover sitemap links
            sitemap_urls = await self._discover_sitemap_urls(client)
            if sitemap_urls:
                await self._emit_event("sitemap_found", {"count": len(sitemap_urls), "message": f"Discovered sitemap with {len(sitemap_urls)} pages"})
                for u in sitemap_urls[:25]:
                    parsed_u = urlparse(u)
                    score, p_type = score_page_priority(parsed_u.path)
                    frontier.append((score, 1, u))

            # 2. Main bounded concurrent crawl loop
            concurrency_limit = 3
            while frontier and len(self.results) < self.max_pages and self._time_left() > 0:
                frontier.sort(key=lambda x: (x[0], -x[1]))
                batch = []
                while frontier and len(batch) < concurrency_limit and (len(self.results) + len(batch)) < self.max_pages:
                    score, depth, current_url = frontier.pop()
                    clean_curr = current_url.split("?")[0].rstrip("/")
                    if clean_curr in self.visited:
                        continue
                    self.visited.add(clean_curr)

                    # Syntax/hostname check here; the IP is validated at connect time.
                    try:
                        validated_url = normalize_url(current_url)
                    except UnsafeURLError:
                        continue
                    batch.append((score, depth, current_url, validated_url))

                if not batch:
                    continue

                tasks = [
                    self._process_single_page(client, score, depth, current_url, validated_url, frontier)
                    for score, depth, current_url, validated_url in batch
                ]
                await asyncio.gather(*tasks)
                if len(frontier) > MAX_FRONTIER:
                    frontier.sort(key=lambda x: (x[0], -x[1]))
                    del frontier[: len(frontier) - MAX_FRONTIER]
                await asyncio.sleep(0.1)

        await self._emit_event("crawl_completed", {
            "total_pages": len(self.results),
            "successful_pages": len([p for p in self.results if p["status"] == "processed"]),
            "message": f"Crawl complete. {len(self.results)} pages ingested."
        })

        return self.results

    async def _reader_fallback(self, client: httpx.AsyncClient, validated_url: str) -> Optional[str]:
        """Rendered-text fallback via the public r.jina.ai reader (bot walls / SPAs)."""
        try:
            resp, text, _ = await self._get(client, f"https://r.jina.ai/{validated_url}", headers={"x-no-cache": "true"}, deadline=15.0)
            if resp.status_code == 200:
                return text
        except Exception as fb_err:
            print(f"[Crawler Fallback Failed] {type(fb_err).__name__}")
        return None

    async def _process_single_page(
        self,
        client: httpx.AsyncClient,
        score: int,
        depth: int,
        current_url: str,
        validated_url: str,
        frontier: List[tuple[int, int, str]]
    ):
        await self._emit_event("page_fetching", {
            "url": current_url,
            "pages_processed": len(self.results),
            "pages_discovered": len(self.visited) + len(frontier),
            "message": f"Reading page: {urlparse(current_url).path or '/'}"
        })

        try:
            resp, resp_text, _truncated = await self._get(client, validated_url)
            is_markdown_fallback = False
            extracted = None

            if resp.status_code != 200:
                # Resilient fallback: If rate-limited (429) or bot-shielded (403/503), fetch via reader proxy
                if resp.status_code in (403, 429, 503):
                    f_text = await self._reader_fallback(client, validated_url)
                    if f_text and len(f_text) > 40:
                        title_m = re.search(r"^Title:\s*(.+)$", f_text, re.M)
                        f_title = title_m.group(1).strip() if title_m else (urlparse(current_url).netloc)
                        clean_content = re.sub(r"^Title:.*?\n|URL Source:.*?\n|Published Time:.*?\n|Warning:.*?\n|Markdown Content:\n", "", f_text).strip()
                        clean_content = re.sub(r"!\[.*?\]\(.*?\)", "", clean_content)
                        clean_content = re.sub(r"\n{3,}", "\n\n", clean_content).strip()

                        discovered_markdown_links = extract_markdown_internal_links(self.base_url, f_text)

                        extracted = {
                            "title": f_title,
                            "clean_text": clean_content,
                            "meta_description": f"Verified intelligence for {f_title}",
                            "internal_links": discovered_markdown_links
                        }
                        is_markdown_fallback = True

                if not is_markdown_fallback:
                    self.results.append({
                        "url": current_url,
                        "title": "Failed to load",
                        "clean_text": "",
                        "status": "failed",
                        "http_status": resp.status_code,
                        "error_message": f"HTTP {resp.status_code}"
                    })
                    return

            if not is_markdown_fallback:
                content_type = resp.headers.get("content-type", "").lower()
                if "text/html" not in content_type and "text/plain" not in content_type:
                    return

                # HTML parsing is CPU-bound: keep it off the event loop.
                extracted = await asyncio.to_thread(extract_clean_page_content, resp_text, str(resp.url))

                # Single Page App (SPA) / Client-Rendered DOM Detection
                soup_has_headings = bool(re.search(r"<\s*h[1-4][^>]*>", resp_text, re.I))
                is_unhydrated_spa = (
                    (len(extracted.get("clean_text", "")) < 600 or not soup_has_headings)
                    and (
                        '<div id="root"' in resp_text
                        or '<div id="app"' in resp_text
                        or '<div id="__next"' in resp_text
                        or '<main id=' in resp_text
                        or 'window.__INITIAL_STATE__' in resp_text
                        or '<script' in resp_text
                    )
                )
                if is_unhydrated_spa:
                    f_text = await self._reader_fallback(client, validated_url)
                    if f_text and len(f_text) > len(extracted.get("clean_text", "")):
                        # If Jina returned a stale or partial cache snapshot, force fresh render with query parameter
                        if "Warning: This is a cached snapshot" in f_text or len(f_text) < 900:
                            buster = await self._reader_fallback(client, f"{validated_url}?no-cache=1")
                            if buster and len(buster) > len(f_text):
                                f_text = buster

                        title_m = re.search(r"^Title:\s*(.+)$", f_text, re.M)
                        f_title = title_m.group(1).strip() if title_m else (extracted.get("title") or urlparse(current_url).netloc)
                        clean_content = re.sub(r"^Title:.*?\n|URL Source:.*?\n|Published Time:.*?\n|Warning:.*?\n|Markdown Content:\n", "", f_text).strip()
                        clean_content = re.sub(r"!\[.*?\]\(.*?\)", "", clean_content)
                        clean_content = re.sub(r"\n{3,}", "\n\n", clean_content).strip()

                        discovered_markdown_links = extract_markdown_internal_links(self.base_url, f_text)

                        extracted = {
                            "title": f_title if f_title and f_title != "Untitled Page" else extracted["title"],
                            "clean_text": clean_content,
                            "meta_description": extracted.get("meta_description") or f"Verified intelligence for {f_title}",
                            "internal_links": list(set(extracted.get("internal_links", []) + discovered_markdown_links))
                        }

            if not extracted or len(extracted.get("clean_text", "")) < 40:
                return

            page_score, initial_type = score_page_priority(urlparse(current_url).path)
            page_type = classify_page_by_content(extracted["clean_text"], extracted["title"], initial_type)

            page_result = {
                "url": str(resp.url),
                "title": extracted["title"],
                "clean_text": extracted["clean_text"],
                "meta_description": extracted.get("meta_description", ""),
                "page_type": page_type,
                "status": "processed",
                "http_status": 200,
                "error_message": None
            }
            self.results.append(page_result)

            await self._emit_event("page_processed", {
                "url": str(resp.url),
                "title": extracted["title"],
                "page_type": page_type,
                "pages_processed": len(self.results),
                "pages_discovered": len(self.visited) + len(frontier),
                "message": f"Extracted: {extracted['title'][:40]}"
            })

            # Add discovered internal links to frontier if depth allows
            if depth < self.max_depth:
                for link in extracted["internal_links"]:
                    if len(frontier) >= MAX_FRONTIER:
                        break
                    clean_link = link.split("?")[0].rstrip("/")
                    if clean_link not in self.visited:
                        l_score, _ = score_page_priority(urlparse(link).path)
                        frontier.append((l_score, depth + 1, link))

        except UnsafeURLError as e:
            self.results.append({
                "url": current_url,
                "title": "Blocked",
                "clean_text": "",
                "status": "failed",
                "http_status": 0,
                "error_message": str(e)
            })
            await self._emit_event("page_error", {"url": current_url, "error": str(e)})
        except Exception as e:
            reason = "Timed out" if isinstance(e, asyncio.TimeoutError) else (str(e) or type(e).__name__)
            self.results.append({
                "url": current_url,
                "title": "Crawl Error",
                "clean_text": "",
                "status": "failed",
                "http_status": 500,
                "error_message": reason[:300]
            })
            await self._emit_event("page_error", {"url": current_url, "error": reason[:300]})
