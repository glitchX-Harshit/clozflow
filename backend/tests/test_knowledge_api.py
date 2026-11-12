import io
import os
import socket
import sys
import uuid
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
import test_leads_helpers as h  # noqa: E402

import pytest  # noqa: E402

import routers.knowledge as knowledge_router  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import Capsule  # noqa: E402
from models_knowledge import CapsuleVersion, KnowledgeFact, KnowledgeSource  # noqa: E402
from services.knowledge.job_manager import KnowledgeJobManager  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh():
    h.reset_limits()
    yield
    h.reset_limits()


@pytest.fixture
def captured_jobs(monkeypatch):
    """Replace the background pipelines with recorders (no LLM / network)."""
    jobs = []
    mgr = KnowledgeJobManager.get_instance()

    async def fake_docs(job_id, user_id, files_data):
        mgr._remember_owner(job_id, user_id)
        jobs.append(("docs", job_id, user_id, files_data))

    async def fake_site(job_id, user_id, url):
        mgr._remember_owner(job_id, user_id)
        jobs.append(("site", job_id, user_id, url))

    monkeypatch.setattr(mgr, "start_document_ingestion_job", fake_docs)
    monkeypatch.setattr(mgr, "start_website_ingestion_job", fake_site)
    return jobs


def _upload(headers, files):
    return h.client().post("/api/knowledge/upload", headers=headers,
                           files=[("files", (name, data, "application/octet-stream")) for name, data in files])


def _docx_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", "<w:document/>")
    return buf.getvalue()


def test_upload_accepts_valid_documents_with_safe_names(captured_jobs):
    _, headers = h.make_user()
    resp = _upload(headers, [("../../etc/notes.txt", b"Pricing: $49 per month"), ("deck.docx", _docx_bytes()),
                             ("C:\\Users\\me\\report.pdf", b"%PDF-1.7\n...")])
    assert resp.status_code == 200, resp.text
    assert resp.json()["files_count"] == 3
    names = [name for name, _ in captured_jobs[-1][3]]
    assert names == ["notes.txt", "deck.docx", "report.pdf"]


@pytest.mark.parametrize("files,status,needle", [
    ([("empty.txt", b"")], 400, "empty"),
    ([("tool.exe", b"MZ\x90\x00")], 415, "Unsupported"),
    ([("old.doc", b"\xd0\xcf\x11\xe0legacy")], 415, "Legacy"),
    ([("old.xls", b"\xd0\xcf\x11\xe0legacy")], 415, "Legacy"),
    ([("fake.pdf", b"just text pretending")], 415, "PDF"),
    ([("fake.docx", b"PK\x03\x04garbage")], 415, "docx"),
    ([("data.json", b"{not json")], 415, "JSON"),
    ([("binary.txt", b"\x00\x01\x02\x03")], 415, "binary"),
    ([("noext", b"hello")], 415, "Unsupported"),
])
def test_upload_rejects_bad_files(captured_jobs, files, status, needle):
    _, headers = h.make_user()
    resp = _upload(headers, files)
    assert resp.status_code == status, resp.text
    assert needle.lower() in resp.json()["detail"].lower()
    assert captured_jobs == []


def test_upload_size_and_count_limits(captured_jobs, monkeypatch):
    _, headers = h.make_user()
    monkeypatch.setattr(knowledge_router, "MAX_UPLOAD_FILE_BYTES", 1000)
    resp = _upload(headers, [("big.txt", b"a" * 1001)])
    assert resp.status_code == 413 and "20 MB" in resp.json()["detail"]
    many = [(f"f{i}.txt", b"hello") for i in range(knowledge_router.MAX_UPLOAD_FILES + 1)]
    assert _upload(headers, many).status_code == 400
    assert captured_jobs == []


def test_crawl_rejects_internal_targets(captured_jobs, monkeypatch):
    _, headers = h.make_user()

    def fake_getaddrinfo(host, port, *a, **k):
        table = {"intranet.test": "10.0.0.8", "public.test": "93.184.216.34"}
        if host not in table:
            raise socket.gaierror("unknown")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (table[host], port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    c = h.client()
    for url in ("http://localhost:8000", "http://169.254.169.254/latest", "http://intranet.test/", "file:///etc/passwd"):
        resp = c.post("/api/knowledge/crawl", json={"url": url}, headers=headers)
        assert resp.status_code == 400, (url, resp.text)
        assert resp.json()["detail"].startswith("Security check failed")
    ok = c.post("/api/knowledge/crawl", json={"url": "public.test"}, headers=headers)
    assert ok.status_code == 200 and ok.json()["url"] == "https://public.test"
    assert captured_jobs[-1][0] == "site"


def test_job_status_and_stream_are_owner_only(captured_jobs):
    uid_a, a = h.make_user("a")
    _, b = h.make_user("b")
    mgr = KnowledgeJobManager.get_instance()
    job_id = str(uuid.uuid4())
    mgr._remember_owner(job_id, uid_a)
    mgr._job_cache[job_id] = {"status": "completed", "progress": 100, "message": "done"}
    c = h.client()
    assert c.get(f"/api/knowledge/jobs/{job_id}", headers=b).status_code == 404
    assert c.get(f"/api/knowledge/jobs/{job_id}/stream", headers=b).status_code == 404
    assert c.get(f"/api/knowledge/jobs/{job_id}", headers=a).json()["status"] == "completed"
    # A finished job's stream returns the terminal snapshot and closes.
    stream = c.get(f"/api/knowledge/jobs/{job_id}/stream", headers=a)
    assert stream.status_code == 200
    events = h.parse_sse(stream.text)
    assert len(events) == 1 and '"completed"' in events[0][1]


def _capsule(db, user_id, **kw):
    cap = Capsule(user_id=user_id, name=kw.pop("name", "Acme"), product_name=kw.pop("product_name", "Acme"), **kw)
    db.add(cap)
    db.commit()
    db.refresh(cap)
    return cap.id


def test_custom_fact_requires_own_capsule():
    uid_a, a = h.make_user("a")
    _, b = h.make_user("b")
    with SessionLocal() as db:
        cap_id = _capsule(db, uid_a)
    body = {"capsule_id": cap_id, "category": "product", "field_name": "Price", "value": "$10"}
    c = h.client()
    assert c.post("/api/knowledge/facts", json=body, headers=b).status_code == 404
    assert c.post("/api/knowledge/facts", json=body, headers=a).status_code == 200


INTEL = {
    "business_intelligence": {"company_name": {"value": "Acme"}, "business_description": {"value": "Widgets"}},
    "products": [{"product_name": "Acme Widget", "description": "A widget", "features": ["fast"]}],
    "customer_intelligence": {"target_segments": ["SMBs"], "pain_points": ["slow"]},
    "sales_intelligence": {"sales_talking_points": ["Fast"]},
}


def test_saving_knowledge_again_merges_by_source():
    uid, _ = h.make_user()
    url = "https://acme.example"
    with SessionLocal() as db:
        published_same = _capsule(db, uid, capsule_type="company", status="published", company_name="Acme",
                                  intelligence_data={"source_url": url, "source_id": "S1"})
        draft_same = _capsule(db, uid, capsule_type="product", status="draft", company_name="Acme",
                              intelligence_data={"source_url": url, "source_id": "S1"})
        edited_same = _capsule(db, uid, capsule_type="product", status="draft", company_name="Acme",
                               intelligence_data={"source_url": url, "source_id": "S1"})
        db.add(KnowledgeFact(user_id=uid, capsule_id=edited_same, category="product", field_name="Price",
                             value="$5", inference_type="user_confirmed"))
        other_source = _capsule(db, uid, capsule_type="product", status="draft", company_name="Acme",
                                intelligence_data={"source_url": "document://pricing.pdf", "source_id": "S2"})
        manual = _capsule(db, uid, name="Acme Enterprise Plan", product_name="Acme Enterprise Plan")
        db.commit()

        report = {}
        created = KnowledgeJobManager.get_instance()._persist_capsules_and_facts(
            db, uid, url, INTEL, [{"url": url, "title": "Home", "clean_text": "Acme widgets"}],
            source_id="S1-resync", merge_report=report,
        )
        remaining = {c.id for c in db.query(Capsule).filter(Capsule.user_id == uid).all()}
        assert draft_same not in remaining  # unreviewed draft of the same source superseded
        assert {published_same, edited_same, other_source, manual} <= remaining
        assert report["strategy"] == "merge_by_source"
        assert report["superseded_capsule_ids"] == [draft_same]
        assert set(report["preserved_capsule_ids"]) == {published_same, edited_same}
        assert all(c.intelligence_data["source_id"] == "S1-resync" for c in created)
        assert db.query(CapsuleVersion).filter(CapsuleVersion.capsule_id == draft_same).count() == 0


def test_delete_source_only_removes_its_own_knowledge():
    uid, headers = h.make_user()
    with SessionLocal() as db:
        db.add(KnowledgeSource(id="src-web", user_id=uid, source_type="website", title="acme.example",
                               source_url="https://acme.example", status="completed"))
        db.add(KnowledgeSource(id="src-doc", user_id=uid, source_type="document", title="pricing.pdf",
                               status="completed", metadata_info={"files": ["pricing.pdf"]}))
        db.commit()
        web_cap = _capsule(db, uid, capsule_type="company", company_name="acme.example",
                           intelligence_data={"source_url": "https://acme.example", "source_id": "src-web"})
        doc_cap = _capsule(db, uid, capsule_type="product", name="acme.example pricing", company_name="acme.example",
                           intelligence_data={"source_url": "document://pricing.pdf", "source_id": "src-doc"})
        manual = _capsule(db, uid, name="acme.example manual notes")
        db.add(KnowledgeFact(user_id=uid, capsule_id=doc_cap, category="product", field_name="Price", value="$9",
                             source_url="document://pricing.pdf"))
        db.commit()

    resp = h.client().delete("/api/knowledge/sources/src-web", headers=headers)
    assert resp.status_code == 200, resp.text
    with SessionLocal() as db:
        remaining = {c.id for c in db.query(Capsule).filter(Capsule.user_id == uid).all()}
        assert web_cap not in remaining
        assert {doc_cap, manual} <= remaining
        assert db.query(KnowledgeFact).filter(KnowledgeFact.capsule_id == doc_cap).count() == 1


def test_source_routes_check_ownership_before_cancelling(monkeypatch):
    uid_a, _ = h.make_user("a")
    _, b = h.make_user("b")
    with SessionLocal() as db:
        db.add(KnowledgeSource(id="src-a", user_id=uid_a, source_type="website", title="a.example",
                               source_url="https://a.example", status="crawling"))
        db.commit()
    cancelled = []
    monkeypatch.setattr(KnowledgeJobManager.get_instance(), "cancel_job", lambda job_id: cancelled.append(job_id))
    c = h.client()
    assert c.post("/api/knowledge/sources/src-a/resync", headers=b).status_code == 404
    assert c.delete("/api/knowledge/sources/src-a", headers=b).status_code == 404
    assert cancelled == []
