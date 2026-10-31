import re
import socket
import ipaddress
import asyncio
from typing import List, Dict, Any, Optional, Set, Callable
from urllib.parse import urlparse, urljoin
import xml.etree.ElementTree as ET

import httpx
from bs4 import BeautifulSoup


# ── SSRF Security Guard ───────────────────────────────────────────────────────

BLOCKED_IP_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),       # Cloud metadata (AWS, GCP, Azure, DigitalOcean)
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),          # Multicast
    ipaddress.ip_network("240.0.0.0/4"),          # Reserved
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("::1/128"),              # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),             # IPv6 unique local
    ipaddress.ip_network("fe80::/10"),            # IPv6 link-local
]

BLOCKED_HOSTNAMES = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "metadata.google.internal",
    "instance-data",
}

def validate_url_security(url: str) -> tuple[bool, str]:
    """
    Validates a URL against SSRF, dangerous schemes, and private IP targets.
    Returns (is_safe, error_or_normalized_url).
    """
    try:
        parsed = urlparse(url)
        if not parsed.scheme or parsed.scheme.lower() not in ("http", "https"):
            return False, "Only HTTP and HTTPS URLs are permitted."

        hostname = parsed.hostname
        if not hostname:
            return False, "Invalid URL: missing hostname."

        hostname_lower = hostname.lower()
        if hostname_lower in BLOCKED_HOSTNAMES or hostname_lower.endswith(".local") or hostname_lower.endswith(".internal"):
            return False, f"Target destination '{hostname}' is not permitted."

        # DNS resolution check
        try:
            addr_info = socket.getaddrinfo(hostname, None)
            for item in addr_info:
                ip_str = item[4][0]
                ip_obj = ipaddress.ip_address(ip_str)
                for net in BLOCKED_IP_NETWORKS:
                    if ip_obj in net:
                        return False, f"Destination IP {ip_str} resolves to a private or restricted network."
        except socket.gaierror:
            return False, f"Could not resolve domain '{hostname}'."

        normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if parsed.query:
            normalized += f"?{parsed.query}"
        return True, normalized
    except Exception as e:
        return False, f"URL validation failed: {str(e)}"


# ── Page Priority Categorization ─────────────────────────────────────────────

PRIORITY_PATTERNS = [
    (r"/(pricing|plans|cost|tiers|quote)", 100, "pricing"),
    (r"/(product|products|platform|features|capabilities|services|overview)", 90, "product"),
    (r"/(solution|solutions|use-cases|industries)", 80, "solution"),
    (r"/(about|company|who-we-are|team|story)", 70, "about"),
    (r"/(faq|frequently-asked-questions|help|knowledge-base)", 65, "faq"),
    (r"/(case-studies|customers|testimonials|reviews|success-stories)", 60, "case_study"),
    (r"/(docs|documentation|guides|resources)", 50, "documentation"),
    (r"/(blog|posts|articles|insights|news|stories)", 45, "blog"),
]

def score_page_priority(path: str) -> tuple[int, str]:
    p = path.lower()
    if p in ("/", "", "/index.html", "/home"):
        return 110, "homepage"
    for pattern, score, p_type in PRIORITY_PATTERNS:
        if re.search(pattern, p):
            return score, p_type
    return 30, "general"


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
            # Exclude media, pdfs, images, login, admin
            if not re.search(r"\.(png|jpg|jpeg|gif|webp|svg|css|js|ico|woff|zip)$", clean_link, re.I):
                if not re.search(r"/(login|signin|signup|register|admin|wp-admin|cart|checkout)/?", clean_link, re.I):
                    discovered_links.add(clean_link)

    return {
        "title": title or "Untitled Page",
        "clean_text": clean_text,
        "meta_description": meta_desc,
        "internal_links": list(discovered_links)
    }


# ── Production Website Crawler ───────────────────────────────────────────────

class WebsiteCrawler:
    def __init__(
        self,
        base_url: str,
        max_pages: int = 18,
        max_depth: int = 2,
        request_timeout: float = 12.0,
        event_callback: Optional[Callable[[Dict[str, Any]], Any]] = None
    ):
        self.base_url = base_url
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.timeout = request_timeout
        self.event_callback = event_callback
        self.visited: Set[str] = set()
        self.results: List[Dict[str, Any]] = []

    async def _emit_event(self, event_type: str, data: Dict[str, Any]):
        if self.event_callback:
            try:
                res = self.event_callback({"type": event_type, **data})
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                print(f"[Crawler Event Error] {e}")

    async def _discover_sitemap_urls(self, client: httpx.AsyncClient) -> List[str]:
        """Attempt to read sitemap.xml for high-priority pages."""
        parsed = urlparse(self.base_url)
        sitemap_candidates = [
            f"{parsed.scheme}://{parsed.netloc}/sitemap.xml",
            f"{parsed.scheme}://{parsed.netloc}/sitemap_index.xml",
        ]
        urls_found = []
        for s_url in sitemap_candidates:
            try:
                is_safe, _ = validate_url_security(s_url)
                if not is_safe:
                    continue
                resp = await client.get(s_url, timeout=6.0, follow_redirects=True)
                if resp.status_code == 200 and "xml" in resp.headers.get("content-type", ""):
                    root = ET.fromstring(resp.text)
                    # Namespace-agnostic tag check
                    for elem in root.iter():
                        if elem.tag.endswith("loc") and elem.text:
                            loc = elem.text.strip()
                            if loc.startswith("http") and parsed.netloc in loc:
                                urls_found.append(loc)
                if urls_found:
                    break
            except Exception:
                pass
        return urls_found

    async def crawl(self) -> List[Dict[str, Any]]:
        is_safe, norm_url = validate_url_security(self.base_url)
        if not is_safe:
            raise ValueError(f"Security validation failed: {norm_url}")

        self.base_url = norm_url
        parsed_base = urlparse(self.base_url)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 ClozFlow-Crawler/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        # Queue of tuples: (score, depth, url)
        # Higher score popped first
        frontier: List[tuple[int, int, str]] = []
        frontier.append((120, 0, self.base_url))

        await self._emit_event("connecting", {"url": self.base_url, "message": "Connecting to website..."})

        async with httpx.AsyncClient(headers=headers, timeout=self.timeout, follow_redirects=True) as client:
            # 1. Discover sitemap links
            sitemap_urls = await self._discover_sitemap_urls(client)
            if sitemap_urls:
                await self._emit_event("sitemap_found", {"count": len(sitemap_urls), "message": f"Discovered sitemap with {len(sitemap_urls)} pages"})
                for u in sitemap_urls[:25]:
                    parsed_u = urlparse(u)
                    score, p_type = score_page_priority(parsed_u.path)
                    frontier.append((score, 1, u))

            # 2. Main crawl loop
            while frontier and len(self.results) < self.max_pages:
                # Sort frontier so highest score is last, then pop()
                frontier.sort(key=lambda x: (x[0], -x[1]))
                score, depth, current_url = frontier.pop()

                clean_curr = current_url.split("?")[0].rstrip("/")
                if clean_curr in self.visited:
                    continue
                self.visited.add(clean_curr)

                # Re-validate destination URL
                is_safe, validated_url = validate_url_security(current_url)
                if not is_safe:
                    continue

                await self._emit_event("page_fetching", {
                    "url": current_url,
                    "pages_processed": len(self.results),
                    "pages_discovered": len(self.visited) + len(frontier),
                    "message": f"Reading page: {urlparse(current_url).path or '/'}"
                })

                try:
                    resp = await client.get(validated_url)
                    if resp.status_code != 200:
                        self.results.append({
                            "url": current_url,
                            "title": "Failed to load",
                            "clean_text": "",
                            "status": "failed",
                            "http_status": resp.status_code,
                            "error_message": f"HTTP {resp.status_code}"
                        })
                        continue

                    # Verify text/html
                    content_type = resp.headers.get("content-type", "").lower()
                    if "text/html" not in content_type and "text/plain" not in content_type:
                        continue

                    extracted = extract_clean_page_content(resp.text, str(resp.url))

                    # If content too short, skip
                    if len(extracted["clean_text"]) < 40:
                        continue

                    page_score, page_type = score_page_priority(urlparse(current_url).path)

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
                            clean_link = link.split("?")[0].rstrip("/")
                            if clean_link not in self.visited:
                                l_score, _ = score_page_priority(urlparse(link).path)
                                frontier.append((l_score, depth + 1, link))

                except Exception as e:
                    self.results.append({
                        "url": current_url,
                        "title": "Crawl Error",
                        "clean_text": "",
                        "status": "failed",
                        "http_status": 500,
                        "error_message": str(e)
                    })
                    await self._emit_event("page_error", {"url": current_url, "error": str(e)})

                # Friendly pacing between requests
                await asyncio.sleep(0.15)

        await self._emit_event("crawl_completed", {
            "total_pages": len(self.results),
            "successful_pages": len([p for p in self.results if p["status"] == "processed"]),
            "message": f"Crawl complete. {len(self.results)} pages ingested."
        })

        return self.results
