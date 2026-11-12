import uuid
import json
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, HttpUrl
from starlette.concurrency import run_in_threadpool

from database import get_db
from models import User, Capsule
from models_knowledge import KnowledgeSource, KnowledgePage, KnowledgeFact, CapsuleVersion, KnowledgeChunk
from routers.auth import get_current_user
from services.knowledge.url_safety import validate_url_security_async
from services.knowledge.document_parser import (
    LEGACY_EXTENSIONS,
    SUPPORTED_EXTENSIONS,
    file_extension,
    sanitize_upload_filename,
    sniff_document_problem,
)
from services.knowledge.job_manager import (
    KnowledgeJobManager, STAGES, TERMINAL_JOB_STATUSES, CANCELLED_IMPORT_ERROR, fail_abandoned_imports,
)
from services.usage_limits import WindowRateLimiter, user_key

logger = logging.getLogger("routers.knowledge")


def _fail_imports_abandoned_by_restart() -> int:
    from database import SessionLocal
    with SessionLocal() as db:
        return fail_abandoned_imports(db)


@asynccontextmanager
async def lifespan(app):
    # Imports that were running when the previous server process stopped can never finish:
    # mark them failed (with a clear error) instead of "running" forever.
    try:
        count = await run_in_threadpool(_fail_imports_abandoned_by_restart)
        if count:
            logger.info("[Knowledge] Marked %d interrupted import(s) as failed", count)
    except Exception as exc:  # never block startup on this
        logger.warning("[Knowledge] Could not check for interrupted imports: %s", exc)
    yield


router = APIRouter(prefix="/api/knowledge", tags=["knowledge"], lifespan=lifespan)

# ── Limits ────────────────────────────────────────────────────────────────────
MAX_UPLOAD_FILES = 10
MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024      # 20 MB per document
MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024    # per request
MAX_ACTIVE_JOBS_PER_USER = 2
_READ_CHUNK = 1024 * 1024

# Each ingestion runs a crawl plus three LLM extraction passes.
_ingestion_limiter = WindowRateLimiter(
    "knowledge-ingest", 10, 600,
    "Too many knowledge imports. Please wait a few minutes before starting another one.",
)


def _start_ingestion_guard(current_user: User) -> None:
    _ingestion_limiter.hit(user_key(current_user))
    if KnowledgeJobManager.get_instance().active_job_count(current_user.id) >= MAX_ACTIVE_JOBS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"You already have {MAX_ACTIVE_JOBS_PER_USER} knowledge imports running. Wait for one to finish.",
            headers={"Retry-After": "30"},
        )


def _job_visible_to(job_id: str, user: User, db: Session) -> bool:
    """A job is visible to its owner only (other users get 404)."""
    owner = KnowledgeJobManager.get_instance().get_job_owner(job_id)
    if owner is not None:
        return owner == user.id
    return db.query(KnowledgeSource.id).filter(
        KnowledgeSource.id == job_id,
        KnowledgeSource.user_id == user.id,
    ).first() is not None


async def _read_upload_capped(upload: UploadFile, name: str) -> bytes:
    """Read at most MAX_UPLOAD_FILE_BYTES (+1 to detect overflow) without
    loading an arbitrarily large upload into memory."""
    if upload.size is not None and upload.size > MAX_UPLOAD_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"File {name} exceeds the 20 MB size limit.")
    chunks = []
    size = 0
    while True:
        chunk = await upload.read(_READ_CHUNK)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_UPLOAD_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"File {name} exceeds the 20 MB size limit.")
        chunks.append(chunk)
    return b"".join(chunks)


# ── Schemas ───────────────────────────────────────────────────────────────────

class CrawlRequest(BaseModel):
    url: str = Field(..., max_length=2048)

class FactUpdateRequest(BaseModel):
    value: Optional[str] = None
    approval_status: Optional[str] = None  # approved | rejected
    inference_type: Optional[str] = None   # user_confirmed

class CreateFactRequest(BaseModel):
    capsule_id: int
    category: str = Field(..., max_length=40)  # business | product | customer | sales
    field_name: str = Field(..., min_length=1, max_length=200)
    value: str = Field(..., min_length=1, max_length=3000)
    inference_type: Optional[str] = "user_confirmed"

class RollbackRequest(BaseModel):
    version_number: int


# ── Ingestion Triggers ────────────────────────────────────────────────────────

@router.post("/crawl")
async def start_website_crawl(
    req: CrawlRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Validates URL security against SSRF and launches real-time crawler.
    (The crawler re-validates every connection, incl. redirects, at connect time.)
    """
    is_safe, res = await validate_url_security_async(req.url)
    if not is_safe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Security check failed: {res}"
        )
    _start_ingestion_guard(current_user)

    job_id = str(uuid.uuid4())
    job_mgr = KnowledgeJobManager.get_instance()
    await job_mgr.start_website_ingestion_job(job_id, current_user.id, res)

    return {
        "job_id": job_id,
        "url": res,
        "status": "connecting",
        "stages": STAGES
    }


@router.post("/upload")
async def upload_documents(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Accepts multiple business documents (PDF, DOCX, XLSX, CSV, JSON, TXT, MD, HTML).

    Limits: at most 10 files, 20 MB per file, 100 MB per request; empty files
    are rejected. The type is checked by extension AND content. Errors:
    400 (no/too many/empty files), 413 (too large), 415 (unsupported type or
    content that does not match the extension).
    """
    try:
        if not files:
            raise HTTPException(400, "No files uploaded")
        if len(files) > MAX_UPLOAD_FILES:
            raise HTTPException(400, f"Too many files: upload at most {MAX_UPLOAD_FILES} documents at a time.")

        files_data = []
        total_bytes = 0
        for f in files:
            name = sanitize_upload_filename(f.filename)
            ext = file_extension(name)
            if ext in LEGACY_EXTENSIONS:
                raise HTTPException(
                    status_code=415,
                    detail=f"Legacy .{ext} files are not supported ({name}). Save it as .{LEGACY_EXTENSIONS[ext]} and upload it again."
                )
            if ext not in SUPPORTED_EXTENSIONS:
                raise HTTPException(
                    status_code=415,
                    detail=f"Unsupported format '{ext}' in file {name}. Allowed formats: PDF, DOCX, XLSX, CSV, JSON, TXT, MD, HTML."
                )
            fbytes = await _read_upload_capped(f, name)
            if not fbytes:
                raise HTTPException(400, f"File {name} is empty.")
            total_bytes += len(fbytes)
            if total_bytes > MAX_UPLOAD_TOTAL_BYTES:
                raise HTTPException(413, "The upload exceeds the 100 MB total size limit. Upload fewer files at a time.")
            problem = await run_in_threadpool(sniff_document_problem, fbytes, ext)
            if problem:
                raise HTTPException(415, f"File {name} {problem}.")
            files_data.append((name, fbytes))
    finally:
        # Release the spooled temp files right away (also on errors).
        for f in files or []:
            try:
                await f.close()
            except Exception:
                pass

    _start_ingestion_guard(current_user)

    job_id = str(uuid.uuid4())
    job_mgr = KnowledgeJobManager.get_instance()
    await job_mgr.start_document_ingestion_job(job_id, current_user.id, files_data)

    return {
        "job_id": job_id,
        "files_count": len(files_data),
        "status": "extracting",
        "stages": STAGES
    }


# ── Job Status & Real-time SSE Stream ─────────────────────────────────────────

@router.get("/jobs/{job_id}")
def get_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch current status and progress of an ingestion job (owner only)."""
    if not _job_visible_to(job_id, current_user, db):
        raise HTTPException(404, "Knowledge job not found")
    job_mgr = KnowledgeJobManager.get_instance()
    cached = job_mgr.get_cached_job(job_id)
    if cached:
        return cached

    # Fallback to database query if job finished earlier (an import abandoned by a server
    # restart is reported - and stored - as failed instead of running forever)
    fail_abandoned_imports(db, user_id=current_user.id, source_ids=[job_id])
    source = db.query(KnowledgeSource).filter(
        KnowledgeSource.id == job_id,
        KnowledgeSource.user_id == current_user.id
    ).first()

    if not source:
        raise HTTPException(404, "Knowledge job not found")

    return {
        "job_id": source.id,
        "status": source.status,
        "progress": 100 if source.status == "completed" else (0 if source.status == "failed" else 50),
        "pages_discovered": source.pages_discovered,
        "pages_processed": source.pages_processed,
        "error": source.error_message,
        "stages": STAGES
    }


def _db_job_snapshot(job_id: str, user_id: int) -> Optional[dict]:
    """Final status from the DB for a job that is no longer running (own session)."""
    from database import SessionLocal
    with SessionLocal() as db:
        fail_abandoned_imports(db, user_id=user_id, source_ids=[job_id])
        source = db.query(KnowledgeSource).filter(
            KnowledgeSource.id == job_id, KnowledgeSource.user_id == user_id
        ).first()
        if not source:
            return None
        terminal = source.status if source.status in TERMINAL_JOB_STATUSES else "failed"
        return {
            "job_id": source.id,
            "status": terminal,
            "progress": 100 if terminal == "completed" else 0,
            "pages_discovered": source.pages_discovered,
            "pages_processed": source.pages_processed,
            "error": source.error_message or (None if terminal == "completed" else "Ingestion stopped before completing."),
            "message": "Ingestion finished." if terminal == "completed" else (source.error_message or "Ingestion stopped before completing."),
        }


@router.get("/jobs/{job_id}/stream")
async def stream_job_events(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Real-time Server-Sent Events (SSE) stream for progressive ingestion UI.
    Allows clients to see live stage transitions and page discoveries.
    The stream always ends after a `completed` / `failed` status event.
    """
    if not _job_visible_to(job_id, current_user, db):
        raise HTTPException(404, "Knowledge job not found")
    user_id = current_user.id
    job_mgr = KnowledgeJobManager.get_instance()
    queue = job_mgr.subscribe(job_id)

    async def event_generator():
        try:
            # Yield initial snapshot if available
            cached = job_mgr.get_cached_job(job_id)
            if cached:
                yield f"data: {json.dumps(cached, default=str)}\n\n"
                if cached.get("status") in TERMINAL_JOB_STATUSES:
                    return

            while True:
                # Wait for next event or send heartbeat
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(event, default=str)}\n\n"
                    if event.get("status") in TERMINAL_JOB_STATUSES:
                        break
                except asyncio.TimeoutError:
                    if not job_mgr.is_job_active(job_id) and queue.empty():
                        # The job is gone (finished in another process, cancelled
                        # or the server restarted): end with a terminal snapshot.
                        final = job_mgr.get_cached_job(job_id)
                        if not final or final.get("status") not in TERMINAL_JOB_STATUSES:
                            final = await run_in_threadpool(_db_job_snapshot, job_id, user_id) or {
                                "job_id": job_id, "status": "failed", "progress": 0,
                                "error": "Ingestion job is no longer running.",
                                "message": "Ingestion job is no longer running.",
                            }
                        yield f"data: {json.dumps(final, default=str)}\n\n"
                        break
                    # Heartbeat keep-alive
                    yield ": ping\n\n"
        finally:
            job_mgr.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ── Knowledge Base Management & Overview ──────────────────────────────────────

@router.get("/overview")
def get_knowledge_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Full Knowledge Base overview: Company Capsule, Product Capsules, Sources, Pages, Stats.
    ``sources[].error_message`` says why an import failed / was cancelled (null otherwise).
    """
    fail_abandoned_imports(db, user_id=current_user.id)
    sources = db.query(KnowledgeSource).filter(
        KnowledgeSource.user_id == current_user.id
    ).order_by(KnowledgeSource.created_at.desc()).all()

    capsules = db.query(Capsule).filter(
        Capsule.user_id == current_user.id
    ).order_by(Capsule.created_at.desc()).all()

    facts = db.query(KnowledgeFact).filter(
        KnowledgeFact.user_id == current_user.id
    ).order_by(KnowledgeFact.created_at.desc()).limit(150).all()

    company_capsule = next((c for c in capsules if getattr(c, "capsule_type", "product") == "company"), None)
    product_capsules = [c for c in capsules if getattr(c, "capsule_type", "product") != "company"]

    total_pages = db.query(KnowledgePage).join(KnowledgeSource).filter(
        KnowledgeSource.user_id == current_user.id
    ).count()
    total_facts = db.query(KnowledgeFact).filter(KnowledgeFact.user_id == current_user.id).count()

    return {
        "stats": {
            "total_capsules": len(capsules),
            "total_products": len(product_capsules),
            "total_sources": len(sources),
            "total_pages": total_pages,
            "total_facts": total_facts,
            "last_synced_at": sources[0].created_at.isoformat() if sources else None
        },
        "company_capsule": {
            "id": company_capsule.id,
            "name": company_capsule.name,
            "company_name": company_capsule.company_name or company_capsule.product_name,
            "brand_tone": company_capsule.brand_tone,
            "status": company_capsule.status,
            "version": company_capsule.version,
            "overview": company_capsule.product_specification,
            "target_audience": company_capsule.target_audience,
            "key_differentiators": company_capsule.key_differentiators,
            "pain_points": company_capsule.pain_points_solved,
            "intelligence_data": company_capsule.intelligence_data
        } if company_capsule else None,
        "product_capsules": [
            {
                "id": c.id,
                "name": c.name,
                "product_name": c.product_name,
                "price": c.product_price,
                "specs": c.product_specification,
                "status": c.status,
                "version": c.version,
                "is_default": c.is_default,
                "intelligence_data": c.intelligence_data
            }
            for c in product_capsules
        ],
        "sources": [
            {
                "id": s.id,
                "type": s.source_type,
                "title": s.title,
                "url": s.source_url,
                "status": s.status,
                "error_message": s.error_message,
                "pages_discovered": s.pages_discovered,
                "pages_processed": s.pages_processed,
                "created_at": s.created_at.isoformat()
            }
            for s in sources
        ],
        "facts": [
            {
                "id": f.id,
                "capsule_id": f.capsule_id,
                "category": f.category,
                "field_name": f.field_name,
                "value": f.value,
                "confidence": f.confidence,
                "inference_type": f.inference_type,
                "approval_status": f.approval_status,
                "source_url": f.source_url,
                "source_excerpt": f.source_excerpt
            }
            for f in facts
        ]
    }


@router.get("/sources/{source_id}/pages")
def get_source_pages(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve discovered pages for a given knowledge source."""
    source = db.query(KnowledgeSource).filter(
        KnowledgeSource.id == source_id,
        KnowledgeSource.user_id == current_user.id
    ).first()
    if not source:
        raise HTTPException(404, "Source not found")

    pages = db.query(KnowledgePage).filter(
        KnowledgePage.source_id == source_id
    ).order_by(KnowledgePage.extracted_at.asc()).all()

    return [
        {
            "id": p.id,
            "url": p.url,
            "title": p.title,
            "page_type": p.page_type,
            "status": p.status,
            "http_status": p.http_status,
            "snippet": p.clean_text[:300] if p.clean_text else "",
            "error": p.error_message
        }
        for p in pages
    ]


@router.delete("/pages/{page_id}")
def toggle_page_exclusion(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Exclude an irrelevant page from knowledge context."""
    page = db.query(KnowledgePage).join(KnowledgeSource).filter(
        KnowledgePage.id == page_id,
        KnowledgeSource.user_id == current_user.id
    ).first()
    if not page:
        raise HTTPException(404, "Page not found")

    page.status = "excluded" if page.status != "excluded" else "processed"
    db.commit()
    return {"id": page.id, "status": page.status}


# ── Fact Review & Approval ───────────────────────────────────────────────────

@router.patch("/facts/{fact_id}")
def update_fact(
    fact_id: str,
    req: FactUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Edit value or approve/reject individual knowledge facts with input validation."""
    fact = db.query(KnowledgeFact).filter(
        KnowledgeFact.id == fact_id,
        KnowledgeFact.user_id == current_user.id
    ).first()
    if not fact:
        raise HTTPException(404, "Fact not found")

    if req.value is not None:
        clean_val = req.value.strip()[:3000]
        fact.value = clean_val
        fact.inference_type = "user_confirmed"
    if req.approval_status is not None:
        status_clean = req.approval_status.lower().strip()
        if status_clean in ("approved", "rejected", "draft"):
            fact.approval_status = status_clean
    if req.inference_type is not None:
        inf_clean = req.inference_type.lower().strip()
        if inf_clean in ("observed_fact", "ai_inference", "user_confirmed"):
            fact.inference_type = inf_clean

    fact.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": fact.id, "approval_status": fact.approval_status, "value": fact.value}


@router.post("/facts")
def create_custom_fact(
    req: CreateFactRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add a custom user-confirmed fact to a Capsule (the caller's own capsule only)."""
    capsule = db.query(Capsule.id).filter(
        Capsule.id == req.capsule_id,
        Capsule.user_id == current_user.id
    ).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")
    category = req.category.strip().lower()
    if category not in ("business", "product", "customer", "sales"):
        raise HTTPException(400, "category must be one of: business, product, customer, sales")
    field_name = req.field_name.strip()
    value = req.value.strip()
    if not field_name or not value:
        raise HTTPException(400, "field_name and value are required")

    fact = KnowledgeFact(
        user_id=current_user.id,
        capsule_id=req.capsule_id,
        category=category,
        field_name=field_name,
        value=value,
        confidence=1.0,
        inference_type="user_confirmed",
        approval_status="approved"
    )
    db.add(fact)
    db.commit()
    db.refresh(fact)
    return {"id": fact.id, "category": fact.category, "field_name": fact.field_name, "value": fact.value}


# ── Capsule Versioning & Publishing ──────────────────────────────────────────

@router.post("/capsules/{capsule_id}/publish")
def publish_capsule(
    capsule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Publishes a Capsule draft, creating a new published version.
    """
    capsule = db.query(Capsule).filter(
        Capsule.id == capsule_id,
        Capsule.user_id == current_user.id
    ).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")

    capsule.version = (capsule.version or 1) + 1
    capsule.status = "published"
    capsule.updated_at = datetime.utcnow()

    # Create immutable version record
    v = CapsuleVersion(
        capsule_id=capsule.id,
        version_number=capsule.version,
        source_snapshot={
            "published_at": datetime.utcnow().isoformat(),
            "name": capsule.name,
            "product_name": capsule.product_name,
            "product_price": capsule.product_price,
            "specs": capsule.product_specification,
            "differentiators": capsule.key_differentiators,
            "pain_points": capsule.pain_points_solved
        },
        approval_status="published",
        approved_by=current_user.email,
        change_summary=f"Published version {capsule.version}"
    )
    db.add(v)
    db.commit()
    return {"id": capsule.id, "version": capsule.version, "status": capsule.status}


@router.post("/capsules/{capsule_id}/rollback")
def rollback_capsule_version(
    capsule_id: int,
    req: RollbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Rolls back a Capsule to a previous version snapshot.
    """
    capsule = db.query(Capsule).filter(
        Capsule.id == capsule_id,
        Capsule.user_id == current_user.id
    ).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")

    target_v = db.query(CapsuleVersion).filter(
        CapsuleVersion.capsule_id == capsule_id,
        CapsuleVersion.version_number == req.version_number
    ).first()
    if not target_v or not target_v.source_snapshot:
        raise HTTPException(404, f"Version {req.version_number} snapshot not found")

    snap = target_v.source_snapshot
    if "capsule_data" in snap:
        cdata = snap["capsule_data"]
    else:
        cdata = snap

    capsule.name = cdata.get("name", capsule.name)
    capsule.product_name = cdata.get("product_name", capsule.product_name)
    capsule.product_price = cdata.get("product_price", capsule.product_price)
    capsule.product_specification = cdata.get("specs", capsule.product_specification)
    capsule.version = req.version_number
    capsule.updated_at = datetime.utcnow()

    db.commit()
    return {"ok": True, "capsule_id": capsule.id, "version": capsule.version}


@router.post("/sources/{source_id}/resync")
async def resync_source(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Re-runs crawl and intelligence extraction for an existing source."""
    # Ownership first: never let another user's request cancel this job.
    source = db.query(KnowledgeSource).filter(
        KnowledgeSource.id == source_id,
        KnowledgeSource.user_id == current_user.id
    ).first()
    if not source:
        raise HTTPException(404, "Source not found")
    if not source.source_url or source.source_type != "website":
        raise HTTPException(400, "Cannot re-sync non-website source")

    is_safe, res = await validate_url_security_async(source.source_url)
    if not is_safe:
        raise HTTPException(status_code=400, detail=f"Security check failed: {res}")
    _ingestion_limiter.hit(user_key(current_user))

    job_mgr = KnowledgeJobManager.get_instance()
    await job_mgr.start_website_ingestion_job(source.id, current_user.id, res)
    return {"job_id": source.id, "status": "crawling", "message": "Re-synchronization started"}


@router.post("/jobs/{job_id}/cancel")
@router.post("/sources/{job_id}/cancel")
async def cancel_knowledge_import(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Cancel a running import (upload, crawl or re-sync) WITHOUT deleting its source. The
    source stays in the overview as ``status: "failed"``, ``error_message: "Import cancelled."``;
    pages it already stored are kept, no capsules are created. Open job streams end with
    ``{"status": "failed", "cancelled": true}``. The job id is the source id.

    404 for an unknown import or another user's; 409 when it already finished.
    """
    mgr = KnowledgeJobManager.get_instance()
    source = db.query(KnowledgeSource).filter(
        KnowledgeSource.id == job_id,
        KnowledgeSource.user_id == current_user.id
    ).first()
    owner = mgr.get_job_owner(job_id)
    if owner is not None and owner != current_user.id:
        raise HTTPException(404, "Import not found")
    if source is None and not (owner == current_user.id and mgr.is_job_active(job_id)):
        raise HTTPException(404, "Import not found")
    if source is not None and source.status in TERMINAL_JOB_STATUSES and not mgr.is_job_active(job_id):
        raise HTTPException(409, f"This import already {'completed' if source.status == 'completed' else 'failed'}; there is nothing to cancel.")

    was_running = await mgr.cancel_import(db, job_id, source)
    return {
        "ok": True,
        "job_id": job_id,
        "status": "failed",
        "cancelled": True,
        "was_running": was_running,
        "error_message": CANCELLED_IMPORT_ERROR,
    }


@router.delete("/capsules/{capsule_id}")
def delete_knowledge_capsule(
    capsule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Deletes a single knowledge capsule and unbinds it from agents."""
    capsule = db.query(Capsule).filter(
        Capsule.id == capsule_id,
        Capsule.user_id == current_user.id
    ).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")

    try:
        from models_pearl import PearlAgent
        db.query(PearlAgent).filter(PearlAgent.capsule_id == capsule_id).update({"capsule_id": None})
    except Exception:
        pass

    db.query(CapsuleVersion).filter(CapsuleVersion.capsule_id == capsule_id).delete(synchronize_session=False)
    db.query(KnowledgeFact).filter(KnowledgeFact.capsule_id == capsule_id).update({"capsule_id": None})
    db.query(KnowledgeChunk).filter(KnowledgeChunk.capsule_id == capsule_id).update({"capsule_id": None})
    db.delete(capsule)
    db.commit()
    return {"message": "Capsule removed"}


@router.delete("/sources/{source_id}")
def delete_knowledge_source(
    source_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Deletes a crawled or uploaded knowledge source, its pages, and derived capsules.

    Only knowledge derived from THIS source is removed: capsules tagged with
    this source id (or, for capsules created before source ids were recorded,
    the same exact source URL), their facts/chunks/versions, and the pages.
    Knowledge from other sources and manual capsules is kept.
    """
    # Ownership first: never let another user's request cancel this job.
    source = db.query(KnowledgeSource).filter(
        KnowledgeSource.id == source_id,
        KnowledgeSource.user_id == current_user.id
    ).first()
    if not source:
        raise HTTPException(404, "Source not found")

    try:
        KnowledgeJobManager.get_instance().cancel_job(source_id)
    except Exception:
        pass

    # URL the ingestion stored on its capsules/facts.
    if source.source_url:
        source_ref_url = source.source_url
    else:
        files = (source.metadata_info or {}).get("files") if isinstance(source.metadata_info, dict) else None
        source_ref_url = f"document://{files[0]}" if files else None
    page_urls = [u for (u,) in db.query(KnowledgePage.url).filter(KnowledgePage.source_id == source_id).all()]

    # 1. Capsules derived from this source
    capsules_to_delete = []
    for c in db.query(Capsule).filter(Capsule.user_id == current_user.id).all():
        intel = c.intelligence_data if isinstance(c.intelligence_data, dict) else {}
        c_source_id = intel.get("source_id")
        if c_source_id == source_id or (not c_source_id and source_ref_url and intel.get("source_url") == source_ref_url):
            capsules_to_delete.append(c.id)

    # 2. Delete pages
    db.query(KnowledgePage).filter(KnowledgePage.source_id == source_id).delete(synchronize_session=False)

    # 3. Facts / chunks of those capsules (+ unattached legacy rows of this exact source)
    if capsules_to_delete:
        db.query(KnowledgeFact).filter(
            KnowledgeFact.user_id == current_user.id,
            KnowledgeFact.capsule_id.in_(capsules_to_delete)
        ).delete(synchronize_session=False)
        db.query(KnowledgeChunk).filter(
            KnowledgeChunk.user_id == current_user.id,
            KnowledgeChunk.capsule_id.in_(capsules_to_delete)
        ).delete(synchronize_session=False)
    if source_ref_url:
        db.query(KnowledgeFact).filter(
            KnowledgeFact.user_id == current_user.id,
            KnowledgeFact.capsule_id.is_(None),
            KnowledgeFact.source_url == source_ref_url
        ).delete(synchronize_session=False)
    if page_urls:
        db.query(KnowledgeChunk).filter(
            KnowledgeChunk.user_id == current_user.id,
            KnowledgeChunk.capsule_id.is_(None),
            KnowledgeChunk.source_url.in_(page_urls)
        ).delete(synchronize_session=False)

    # 4. Unbind agents, then delete the capsules
    if capsules_to_delete:
        try:
            from models_pearl import PearlAgent
            db.query(PearlAgent).filter(
                PearlAgent.capsule_id.in_(capsules_to_delete)
            ).update({"capsule_id": None}, synchronize_session=False)
        except Exception:
            pass
        db.query(CapsuleVersion).filter(CapsuleVersion.capsule_id.in_(capsules_to_delete)).delete(synchronize_session=False)
        db.query(Capsule).filter(
            Capsule.id.in_(capsules_to_delete),
            Capsule.user_id == current_user.id
        ).delete(synchronize_session=False)

    db.delete(source)
    db.commit()
    return {"message": "Source, indexed pages, and associated capsules removed"}


@router.post("/reset")
def reset_entire_knowledge_base(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Completely purges all Knowledge Base context, sources, facts, chunks, and capsules
    for the current user, resetting to a clean slate.
    """
    try:
        from services.knowledge.job_manager import KnowledgeJobManager
        KnowledgeJobManager.get_instance().cancel_user_jobs(current_user.id)
    except Exception:
        pass

    try:
        from models_pearl import PearlAgent
        db.query(PearlAgent).filter(PearlAgent.user_id == current_user.id).update({"capsule_id": None})
    except Exception:
        pass

    db.query(KnowledgeFact).filter(KnowledgeFact.user_id == current_user.id).delete(synchronize_session=False)
    db.query(KnowledgeChunk).filter(KnowledgeChunk.user_id == current_user.id).delete(synchronize_session=False)

    source_ids = [s.id for s in db.query(KnowledgeSource.id).filter(KnowledgeSource.user_id == current_user.id).all()]
    if source_ids:
        db.query(KnowledgePage).filter(KnowledgePage.source_id.in_(source_ids)).delete(synchronize_session=False)
    db.query(KnowledgeSource).filter(KnowledgeSource.user_id == current_user.id).delete(synchronize_session=False)

    capsule_ids = [c.id for c in db.query(Capsule.id).filter(Capsule.user_id == current_user.id).all()]
    if capsule_ids:
        db.query(CapsuleVersion).filter(CapsuleVersion.capsule_id.in_(capsule_ids)).delete(synchronize_session=False)
    db.query(Capsule).filter(Capsule.user_id == current_user.id).delete(synchronize_session=False)

    db.commit()
    return {"message": "All knowledge base context and capsules have been completely removed."}
