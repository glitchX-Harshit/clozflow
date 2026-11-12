"""
Knowledge imports: imports abandoned by a server restart are failed (on startup and when read)
with a clear error, the overview's sources carry ``error_message``, and a running import can be
cancelled without deleting its source. No network: the pipelines are stubbed.
"""
import asyncio
import os
import sys
import uuid
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))
import test_leads_helpers as h  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402

import routers.knowledge as knowledge_router  # noqa: E402
from database import SessionLocal  # noqa: E402
from models_knowledge import KnowledgeSource  # noqa: E402
from services.knowledge import job_manager as jm  # noqa: E402
from services.knowledge.job_manager import KnowledgeJobManager, fail_abandoned_imports  # noqa: E402

BEFORE_START = jm.PROCESS_STARTED_AT - timedelta(minutes=5)


class StubTask:
    """Stands in for a running ingestion task."""

    def __init__(self):
        self.cancelled = False

    def done(self):
        return self.cancelled

    def cancel(self):
        self.cancelled = True


@pytest.fixture
def running_jobs():
    mgr = KnowledgeJobManager.get_instance()
    registered = []

    def register(job_id, user_id):
        task = StubTask()
        mgr._active_tasks[job_id] = task
        mgr._job_user_map[job_id] = user_id
        mgr._remember_owner(job_id, user_id)
        registered.append(job_id)
        return task

    yield register
    for job_id in registered:
        mgr._active_tasks.pop(job_id, None)
        mgr._job_user_map.pop(job_id, None)
        mgr._job_cache.pop(job_id, None)


def add_source(user_id, status, updated_at=None, error=None, source_id=None):
    source_id = source_id or f"src-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        fields = {"created_at": updated_at, "updated_at": updated_at} if updated_at else {}
        db.add(KnowledgeSource(id=source_id, user_id=user_id, source_type="website", title="acme.example",
                               source_url="https://acme.example", status=status, error_message=error, **fields))
        db.commit()
    return source_id


def source(source_id):
    with SessionLocal() as db:
        return db.get(KnowledgeSource, source_id)


def overview_sources(headers):
    resp = h.client().get("/api/knowledge/overview", headers=headers)
    assert resp.status_code == 200, resp.text
    return {s["id"]: s for s in resp.json()["sources"]}


# ── abandoned imports ─────────────────────────────────────────────────────────

def test_overview_sources_include_error_message():
    uid, headers = h.make_user()
    ok = add_source(uid, "completed")
    bad = add_source(uid, "failed", error="Could not extract content from website (HTTP 403).")
    sources = overview_sources(headers)
    assert sources[ok]["error_message"] is None
    assert sources[bad]["error_message"] == "Could not extract content from website (HTTP 403)."


def test_import_interrupted_by_a_restart_reads_as_failed(running_jobs):
    uid, headers = h.make_user()
    abandoned = add_source(uid, "extracting", updated_at=BEFORE_START)
    live = add_source(uid, "connecting", updated_at=BEFORE_START)
    running_jobs(live, uid)                                   # still running in this process
    recent = add_source(uid, "crawling")                     # e.g. another process: left alone

    sources = overview_sources(headers)
    assert (sources[abandoned]["status"], sources[abandoned]["error_message"]) == ("failed", jm.INTERRUPTED_IMPORT_ERROR)
    assert sources[live]["status"] == "connecting" and sources[recent]["status"] == "crawling"
    assert source(abandoned).status == "failed"              # stored, not just reported

    other = add_source(uid, "extracting", updated_at=BEFORE_START)
    job = h.client().get(f"/api/knowledge/jobs/{other}", headers=headers).json()
    assert (job["status"], job["error"], job["progress"]) == ("failed", jm.INTERRUPTED_IMPORT_ERROR, 0)


def test_stalled_import_is_failed():
    uid, _ = h.make_user()
    started = jm.PROCESS_STARTED_AT + timedelta(seconds=10)
    stalled = add_source(uid, "extracting", updated_at=started)
    with SessionLocal() as db:
        assert fail_abandoned_imports(db, user_id=uid, now=started + timedelta(minutes=29)) == 0
        assert fail_abandoned_imports(db, user_id=uid, now=started + timedelta(minutes=31)) == 1
    assert (source(stalled).status, source(stalled).error_message) == ("failed", jm.STALLED_IMPORT_ERROR)


def test_startup_marks_interrupted_imports_failed():
    uid, _ = h.make_user()
    interrupted = add_source(uid, "connecting", updated_at=BEFORE_START)
    done = add_source(uid, "completed", updated_at=BEFORE_START)

    async def startup():
        async with knowledge_router.lifespan(FastAPI()):
            pass

    asyncio.run(startup())
    assert (source(interrupted).status, source(interrupted).error_message) == ("failed", jm.INTERRUPTED_IMPORT_ERROR)
    assert (source(done).status, source(done).error_message) == ("completed", None)


def test_app_startup_runs_the_sweep():
    """The knowledge router's lifespan is merged into the real app's startup."""
    import main
    from fastapi.testclient import TestClient

    uid, _ = h.make_user()
    interrupted = add_source(uid, "extracting", updated_at=BEFORE_START)
    with TestClient(main.app):
        pass
    assert (source(interrupted).status, source(interrupted).error_message) == ("failed", jm.INTERRUPTED_IMPORT_ERROR)


# ── cancel ────────────────────────────────────────────────────────────────────

def test_cancel_a_running_import_keeps_its_source(running_jobs):
    uid, headers = h.make_user()
    job_id = add_source(uid, "extracting")
    task = running_jobs(job_id, uid)
    mgr = KnowledgeJobManager.get_instance()
    assert mgr.active_job_count(uid) == 1

    resp = h.client().post(f"/api/knowledge/jobs/{job_id}/cancel", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "job_id": job_id, "status": "failed", "cancelled": True,
                           "was_running": True, "error_message": "Import cancelled."}
    assert task.cancelled and mgr.active_job_count(uid) == 0
    assert (source(job_id).status, source(job_id).error_message) == ("failed", "Import cancelled.")
    job = h.client().get(f"/api/knowledge/jobs/{job_id}", headers=headers).json()
    assert job["status"] == "failed" and job["cancelled"] is True
    stream = h.client().get(f"/api/knowledge/jobs/{job_id}/stream", headers=headers)
    events = h.parse_sse(stream.text)
    assert len(events) == 1 and '"cancelled": true' in events[0][1]
    assert overview_sources(headers)[job_id]["error_message"] == "Import cancelled."

    # A finished import can't be cancelled.
    again = h.client().post(f"/api/knowledge/sources/{job_id}/cancel", headers=headers)
    assert again.status_code == 409 and "already failed" in again.json()["detail"]


def test_cancel_checks_ownership_and_state(running_jobs):
    uid_a, a = h.make_user("a")
    _, b = h.make_user("b")
    c = h.client()
    job_id = add_source(uid_a, "crawling")
    task = running_jobs(job_id, uid_a)
    assert c.post(f"/api/knowledge/jobs/{job_id}/cancel", headers=b).status_code == 404
    assert not task.cancelled and source(job_id).status == "crawling"
    assert c.post("/api/knowledge/jobs/nope/cancel", headers=a).status_code == 404
    assert c.post("/api/knowledge/jobs/x/cancel").status_code == 401

    finished = add_source(uid_a, "completed")
    resp = c.post(f"/api/knowledge/sources/{finished}/cancel", headers=a)
    assert resp.status_code == 409 and "already completed" in resp.json()["detail"]

    # The task creates the source row itself: a job with no row yet can still be cancelled.
    pending = f"job-{uuid.uuid4().hex[:8]}"
    pending_task = running_jobs(pending, uid_a)
    resp = c.post(f"/api/knowledge/jobs/{pending}/cancel", headers=a)
    assert resp.status_code == 200 and resp.json()["was_running"] is True and pending_task.cancelled

    # Left "running" by a task that is gone (and not old enough to be swept): cancel still works.
    orphan = add_source(uid_a, "extracting")
    resp = c.post(f"/api/knowledge/sources/{orphan}/cancel", headers=a)
    assert resp.status_code == 200 and resp.json()["was_running"] is False
    assert source(orphan).error_message == "Import cancelled."


def _drain(q):
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


def test_a_cancel_sends_one_terminal_event():
    """After cancel_import, the cancelled task's own handler doesn't add a second event
    ("Ingestion was cancelled.") with different wording."""
    mgr = KnowledgeJobManager.get_instance()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    q = mgr.subscribe(job_id)
    try:
        async def cancel_then_task_cleanup():
            await mgr.cancel_import(None, job_id, None)
            await mgr._handle_cancellation(job_id)      # what the cancelled task runs next
        asyncio.run(cancel_then_task_cleanup())
        events = _drain(q)
        assert [(e["message"], e["cancelled"]) for e in events] == [("Import cancelled.", True)]
    finally:
        mgr.unsubscribe(job_id, q)
        mgr._job_cache.pop(job_id, None)


def test_other_cancellations_still_end_the_stream():
    """A task cancelled without cancel_import (source deleted / reset) still tells listeners."""
    mgr = KnowledgeJobManager.get_instance()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    q = mgr.subscribe(job_id)
    try:
        asyncio.run(mgr._handle_cancellation(job_id))
        events = _drain(q)
        assert [(e["message"], e["cancelled"]) for e in events] == [("Ingestion was cancelled.", True)]
    finally:
        mgr.unsubscribe(job_id, q)
        mgr._job_cache.pop(job_id, None)


def test_pipeline_checkpoints_honour_a_cancel():
    uid, _ = h.make_user()
    job_id = add_source(uid, "extracting")
    with SessionLocal() as db:
        assert KnowledgeJobManager._source_still_wanted(db, job_id) is True
        db.get(KnowledgeSource, job_id).status = "failed"
        db.commit()
        assert KnowledgeJobManager._source_still_wanted(db, job_id) is False
        assert KnowledgeJobManager._source_still_wanted(db, "missing") is False


def test_resync_starts_from_a_clean_status(monkeypatch):
    uid, _ = h.make_user()
    job_id = add_source(uid, "failed", error="Import cancelled.")
    seen = []

    class FakeCrawler:
        def __init__(self, base_url, max_pages, event_callback):
            pass

        async def crawl(self):
            seen.append((source(job_id).status, source(job_id).error_message))
            return []

    monkeypatch.setattr(jm, "WebsiteCrawler", FakeCrawler)
    asyncio.run(KnowledgeJobManager.get_instance()._run_website_pipeline(job_id, uid, "https://acme.example"))
    assert seen == [("connecting", None)]                    # the old cancel no longer applies
    assert source(job_id).status == "failed" and "Could not extract content" in source(job_id).error_message
