"""Deploy files stay in sync with the backend (nginx, env template, requirements, Docker)."""
import ast
import os
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
WEB = BACKEND.parent
NGINX = (WEB / "nginx.conf.template").read_text(encoding="utf-8")
UPSTREAM = "proxy_pass http://127.0.0.1:8000;"
_SKIP_DIRS = {".venv", "venv", "__pycache__", "tests", "node_modules"}


# ── nginx location matching (exact, ^~ prefix, regex in order, then longest prefix) ──

def _locations(conf):
    found = re.findall(r"^\s*location\s+(=|\^~|~\*?)?\s*(\S+)\s*\{(.*?)\n\s*\}", conf, re.S | re.M)
    return [{"modifier": m, "pattern": p, "body": b} for m, p, b in found]


LOCATIONS = _locations(NGINX)
SERVER_LEVEL = re.sub(r"^\s*location\s+[^{\n]*\{.*?\n\s*\}", "", NGINX, flags=re.S | re.M)


def resolve(path):
    for loc in LOCATIONS:
        if loc["modifier"] == "=" and loc["pattern"] == path:
            return loc
    prefixes = [l for l in LOCATIONS if l["modifier"] in ("", "^~") and path.startswith(l["pattern"])]
    longest = max(prefixes, key=lambda l: len(l["pattern"]), default=None)
    if longest is not None and longest["modifier"] == "^~":
        return longest
    for loc in LOCATIONS:
        if loc["modifier"] in ("~", "~*") and re.search(loc["pattern"], path, re.I if loc["modifier"] == "~*" else 0):
            return loc
    return longest


def _is_backend(loc):
    return loc is not None and UPSTREAM in loc["body"]


def _seconds(body, directive):
    match = re.search(rf"{directive}\s+(\d+)s;", body)
    return int(match.group(1)) if match else 60  # nginx default


def _app_routes(routes):
    """(path, is_websocket) for everything mounted, through FastAPI's included routers."""
    from fastapi.routing import APIWebSocketRoute
    from starlette.routing import Mount, WebSocketRoute

    for route in routes:
        if hasattr(route, "effective_candidates"):
            yield from _app_routes(route.effective_candidates())
            continue
        original = getattr(route, "original_route", route)
        path = getattr(route, "path", "") or getattr(getattr(route, "starlette_route", None), "path", "")
        if isinstance(original, Mount):
            path = path.rstrip("/") + "/file.png"  # requests go to files under the mount
        if path:
            yield path, isinstance(original, (APIWebSocketRoute, WebSocketRoute))


def _concrete(path):
    return re.sub(r"\{[^}]+\}", "x1", path)


SPA_ROUTES = ["/", "/auth", "/auth/callback", "/dashboard", "/brain", "/call-brief", "/live-call", "/summary",
              "/outreach-studio", "/agent-editor", "/agent-editor/7", "/pearl/agent-editor",
              "/pearl/agent-editor/7", "/relay/abc123", "/how-it-works", "/pricing", "/admin", "/admin/users/3"]
LONG_LIVED = ["/ws", "/ws/audio", "/api/pearl/calls/x1/stream", "/api/pearl/calls/x1/audio",
              "/api/pearl/test-sessions/x1/voice", "/api/copilot/bridge/x1", "/api/copilot/bridge/x1/stream"]
DOCS_ONLY = {"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json", "/"}


def test_every_mounted_backend_path_is_proxied():
    import main  # fails here (only) if any router can't be imported

    paths = sorted(set(_app_routes(main.app.routes)))
    assert paths, "no routes found"
    missing = [p for p, _ in paths if p not in DOCS_ONLY and not _is_backend(resolve(_concrete(p)))]
    assert missing == [], f"nginx.conf.template does not proxy: {missing}"
    for path, is_websocket in paths:
        if is_websocket:
            assert _seconds(resolve(_concrete(path))["body"], "proxy_read_timeout") >= 3600, path


def test_spa_routes_stay_with_the_frontend():
    for path in SPA_ROUTES:
        loc = resolve(path)
        assert loc["pattern"] == "/" and "try_files" in loc["body"], path


def test_known_backend_prefixes_and_sockets():
    for path in ["/intelligence/chat", "/leads/search", "/outreach/generate", "/calls/", "/calls/3/transcript",
                 "/call/start", "/api/user/me", "/auth/login", "/auth/me", "/api/auth/login", "/static/avatars/a.png",
                 "/health", "/api/knowledge/sources", "/api/admin/users", "/api/copilot/sessions/active"]:
        assert _is_backend(resolve(path)), path
    for path in LONG_LIVED:
        body = resolve(path)["body"]
        assert _is_backend(resolve(path)), path
        assert _seconds(body, "proxy_read_timeout") >= 3600 and _seconds(body, "proxy_send_timeout") >= 3600, path
        assert "proxy_buffering off;" in body, path
    for sse in ["/leads/deep-search", "/api/knowledge/jobs/1/events", "/api/pearl/campaigns/1/events"]:
        assert "proxy_buffering off;" in resolve(sse)["body"], sse


def test_server_wide_proxy_settings():
    assert "proxy_set_header Upgrade $http_upgrade;" in SERVER_LEVEL
    assert "proxy_set_header Connection $connection_upgrade;" in SERVER_LEVEL
    assert "proxy_http_version 1.1;" in SERVER_LEVEL
    size = re.search(r"client_max_body_size\s+(\d+)([km]?);", SERVER_LEVEL)
    assert size, "client_max_body_size missing"
    megabytes = int(size.group(1)) * {"k": 1 / 1024, "m": 1, "": 1 / (1024 * 1024)}[size.group(2)]
    assert megabytes >= 100  # knowledge uploads: 20 MB per file, up to 100 MB per request
    for loc in LOCATIONS:  # a location-level proxy_set_header would drop the inherited ones
        assert "proxy_set_header" not in loc["body"], loc["pattern"]


def test_cors_exposes_the_sample_data_header():
    import main
    from starlette.middleware.cors import CORSMiddleware

    cors = next(m for m in main.app.user_middleware if m.cls is CORSMiddleware)
    assert "X-Sample-Data" in cors.kwargs["expose_headers"]
    assert all(not origin.endswith("/") for origin in cors.kwargs["allow_origins"])


# ── env template ─────────────────────────────────────────────────────────────

def _python_files(*roots):
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            for name in filenames:
                if name.endswith(".py") and not name.startswith("test_") and name != "conftest.py":
                    yield Path(dirpath) / name


_ENV_READ = re.compile(r"""(?:os\.getenv|os\.environ\.get|environ\.get|getenv)\(\s*['"]([A-Z][A-Z0-9_]*)['"]|os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]""")


def test_env_example_lists_every_variable_the_backend_reads():
    read = set()
    for path in _python_files(BACKEND, WEB / "rag", WEB / "ml"):
        for a, b in _ENV_READ.findall(path.read_text(encoding="utf-8", errors="replace")):
            read.add(a or b)
    example = (WEB / ".env.example").read_text(encoding="utf-8")
    listed = set(re.findall(r"^([A-Z][A-Z0-9_]*)=", example, re.M))
    assert read - listed == set(), f"add to web/.env.example: {sorted(read - listed)}"
    values = re.findall(r"^[A-Z][A-Z0-9_]*=(.+)$", example, re.M)
    assert values == [], "web/.env.example must not contain values"


def test_no_hardcoded_ngrok_url_in_core_deploy_files():
    for name in ["Dockerfile", "docker-compose.yml", "nginx.conf.template", "supervisord.conf", "entrypoint.sh",
                 ".env.example", "start_all.bat"]:
        assert "ngrok" not in (WEB / name).read_text(encoding="utf-8").lower(), name


# ── requirements ─────────────────────────────────────────────────────────────

# import name -> distribution name when they differ
_DIST_FOR = {"bs4": "beautifulsoup4", "docx": "python-docx", "jwt": "pyjwt", "yaml": "pyyaml",
             "sklearn": "scikit-learn", "dotenv": "python-dotenv", "google": "google-genai",
             "faiss": "faiss-cpu", "silero_vad": "silero-vad", "sentence_transformers": "sentence-transformers",
             "audioop": "audioop-lts", "multipart": "python-multipart", "psycopg2": "psycopg2-binary"}
# torch/torchaudio: installed by the Dockerfile from the CPU index (and pulled in by silero-vad).
# deepgram: only services/deepgram_stream.py, which nothing imports.
_NOT_REQUIRED = {"torch", "torchaudio", "deepgram"}


def test_requirements_cover_every_third_party_import():
    local = {p.stem if p.suffix == ".py" else p.name for base in (BACKEND, WEB) for p in base.iterdir()}
    imported = {}
    for path in _python_files(BACKEND, WEB / "rag", WEB / "ml"):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue  # reported by the import test above
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name.split(".")[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module.split(".")[0]]
            for name in names:
                if name not in sys.stdlib_module_names and name not in local and name != "__future__":
                    imported.setdefault(name, path.relative_to(WEB).as_posix())

    required = set()
    for line in (BACKEND / "requirements_full.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            required.add(re.split(r"[<>=!~;\[\s]", line, maxsplit=1)[0].lower().replace("_", "-"))

    missing = {name: where for name, where in imported.items()
               if name not in _NOT_REQUIRED and _DIST_FOR.get(name, name).lower().replace("_", "-") not in required}
    assert missing == {}, f"add to backend/requirements_full.txt: {missing}"
    assert (BACKEND / "requirements.txt").read_text(encoding="utf-8").strip().endswith("-r requirements_full.txt")


# ── Docker / local scripts ───────────────────────────────────────────────────

def test_docker_files_point_at_real_paths():
    dockerfile = (WEB / "Dockerfile").read_text(encoding="utf-8")
    for source in re.findall(r"^COPY\s+(?!--from)(\S+)\s", dockerfile, re.M):
        assert list(WEB.glob(source.rstrip("/"))), f"Dockerfile COPY source missing: {source}"
    assert "HEALTHCHECK" in dockerfile and "/health" in dockerfile

    compose = (WEB / "docker-compose.yml").read_text(encoding="utf-8")
    env_files = re.findall(r"env_file:\s*\n((?:\s+-\s*\S+\n?)+)", compose)
    assert env_files and all(f.strip() == ".env" for f in re.findall(r"-\s*(\S+)", env_files[0]))

    ignore = (WEB / ".dockerignore").read_text(encoding="utf-8").split()
    for pattern in ("**/.venv", "**/__pycache__", "**/.env", "**/*.db", "backend/static/avatars/*"):
        assert pattern in ignore, pattern

    supervisord = (WEB / "supervisord.conf").read_text(encoding="utf-8")
    assert "directory=/app/backend" in supervisord and "uvicorn main:app" in supervisord


def test_start_all_runs_from_any_directory():
    script = (WEB / "start_all.bat").read_text(encoding="utf-8")
    assert "%~dp0" in script and "main.py" in script
    assert "cd backend" not in script
