import uuid
import json
import asyncio
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, HttpUrl

from database import get_db
from models import User, Capsule
from models_knowledge import KnowledgeSource, KnowledgePage, KnowledgeFact, CapsuleVersion, KnowledgeChunk
from routers.auth import get_current_user
from services.knowledge.crawler import validate_url_security
from services.knowledge.job_manager import KnowledgeJobManager, STAGES

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CrawlRequest(BaseModel):
    url: str

class FactUpdateRequest(BaseModel):
    value: Optional[str] = None
    approval_status: Optional[str] = None  # approved | rejected
    inference_type: Optional[str] = None   # user_confirmed

class CreateFactRequest(BaseModel):
    capsule_id: int
    category: str  # business | product | customer | sales
    field_name: str
    value: str
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
    """
    is_safe, res = validate_url_security(req.url)
    if not is_safe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Security check failed: {res}"
        )

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
    """
    if not files:
        raise HTTPException(400, "No files uploaded")

    ALLOWED_EXTS = {"pdf", "docx", "doc", "xlsx", "xls", "csv", "json", "txt", "md", "markdown", "html", "htm"}
    files_data = []

    for f in files:
        ext = f.filename.split(".")[-1].lower() if "." in f.filename else ""
        if ext not in ALLOWED_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported format '{ext}' in file {f.filename}. Allowed formats: PDF, DOCX, XLSX, CSV, JSON, TXT, MD, HTML."
            )
        fbytes = await f.read()
        if len(fbytes) > 20 * 1024 * 1024:  # 20MB limit
            raise HTTPException(400, f"File {f.filename} exceeds 20MB size limit.")
        files_data.append((f.filename, fbytes))

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
async def get_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch current status and progress of an ingestion job."""
    job_mgr = KnowledgeJobManager.get_instance()
    cached = job_mgr.get_cached_job(job_id)
    if cached:
        return cached

    # Fallback to database query if job finished earlier
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


@router.get("/jobs/{job_id}/stream")
async def stream_job_events(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Real-time Server-Sent Events (SSE) stream for progressive ingestion UI.
    Allows clients to see live stage transitions and page discoveries.
    """
    job_mgr = KnowledgeJobManager.get_instance()
    queue = job_mgr.subscribe(job_id)

    async def event_generator():
        try:
            # Yield initial snapshot if available
            cached = job_mgr.get_cached_job(job_id)
            if cached:
                yield f"data: {json.dumps(cached)}\n\n"

            while True:
                # Wait for next event or send heartbeat
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("status") in ("completed", "failed"):
                        break
                except asyncio.TimeoutError:
                    # Heartbeat keep-alive
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass
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
    """
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

    return {
        "stats": {
            "total_capsules": len(capsules),
            "total_products": len(product_capsules),
            "total_sources": len(sources),
            "total_pages": total_pages,
            "total_facts": len(facts),
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
    """Edit value or approve/reject individual knowledge facts."""
    fact = db.query(KnowledgeFact).filter(
        KnowledgeFact.id == fact_id,
        KnowledgeFact.user_id == current_user.id
    ).first()
    if not fact:
        raise HTTPException(404, "Fact not found")

    if req.value is not None:
        fact.value = req.value
        fact.inference_type = "user_confirmed"
    if req.approval_status is not None:
        fact.approval_status = req.approval_status
    if req.inference_type is not None:
        fact.inference_type = req.inference_type

    fact.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": fact.id, "approval_status": fact.approval_status, "value": fact.value}


@router.post("/facts")
def create_custom_fact(
    req: CreateFactRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add a custom user-confirmed fact to a Capsule."""
    fact = KnowledgeFact(
        user_id=current_user.id,
        capsule_id=req.capsule_id,
        category=req.category,
        field_name=req.field_name,
        value=req.value,
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
    source = db.query(KnowledgeSource).filter(
        KnowledgeSource.id == source_id,
        KnowledgeSource.user_id == current_user.id
    ).first()
    if not source or not source.source_url:
        raise HTTPException(400, "Cannot re-sync non-website source")

    job_mgr = KnowledgeJobManager.get_instance()
    await job_mgr.start_website_ingestion_job(source.id, current_user.id, source.source_url)
    return {"job_id": source.id, "status": "crawling", "message": "Re-synchronization started"}
