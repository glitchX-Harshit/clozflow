import asyncio
import json
from collections import OrderedDict
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Capsule
from models_knowledge import KnowledgeSource, KnowledgePage, KnowledgeFact, CapsuleVersion, KnowledgeChunk
from services.knowledge.crawler import WebsiteCrawler
from services.knowledge.document_parser import parse_uploaded_file
from services.knowledge.intelligence_engine import IntelligenceEngine

MAX_CACHED_JOBS = 1000
TERMINAL_JOB_STATUSES = ("completed", "failed")

# Imports run as tasks of this process. A source row still "connecting" / "extracting" that no
# live task owns was abandoned: the server restarted mid-import (its last update predates this
# process) or it stopped making progress. Production runs one backend process (supervisord
# --workers 1); with several processes an import running in another one could look abandoned.
INTERRUPTED_IMPORT_ERROR = "Import interrupted: the server restarted before it finished. Start the import again."
STALLED_IMPORT_ERROR = "Import stopped making progress and was marked as failed. Start the import again."
CANCELLED_IMPORT_ERROR = "Import cancelled."
STALLED_IMPORT_AFTER = timedelta(minutes=30)
PROCESS_STARTED_AT = datetime.utcnow()


def fail_abandoned_imports(db: Session, *, user_id: Optional[int] = None,
                           source_ids: Optional[List[str]] = None, now: Optional[datetime] = None) -> int:
    """Mark knowledge imports that no task of this process is running as failed (with a clear
    ``error_message``). Returns how many rows were changed (committed)."""
    now = now or datetime.utcnow()
    mgr = KnowledgeJobManager.get_instance()
    q = db.query(KnowledgeSource).filter(
        (KnowledgeSource.status.is_(None)) | (KnowledgeSource.status.notin_(TERMINAL_JOB_STATUSES))
    )
    if user_id is not None:
        q = q.filter(KnowledgeSource.user_id == user_id)
    if source_ids is not None:
        q = q.filter(KnowledgeSource.id.in_(list(source_ids)))
    changed = 0
    for source in q.all():
        if mgr.is_job_active(source.id):
            continue
        last = source.updated_at or source.created_at
        if last is None or last < PROCESS_STARTED_AT:
            source.error_message = INTERRUPTED_IMPORT_ERROR
        elif now - last > STALLED_IMPORT_AFTER:
            source.error_message = STALLED_IMPORT_ERROR
        else:
            continue
        source.status = "failed"
        changed += 1
    if changed:
        db.commit()
    return changed

# How a new ingestion treats capsules created by earlier ingestions.
KNOWLEDGE_MERGE_STRATEGY = "merge_by_source"


STAGES = [
    {"stage": 1, "key": "connecting", "title": "Connecting to your website", "detail": "Validating host security and SSL certificates"},
    {"stage": 2, "key": "discovering", "title": "Discovering relevant pages", "detail": "Inspecting sitemap and navigation hierarchy"},
    {"stage": 3, "key": "reading", "title": "Reading business information", "detail": "Parsing company overview, vision, and core mission"},
    {"stage": 4, "key": "products", "title": "Understanding products and services", "detail": "Mapping product architecture and capabilities"},
    {"stage": 5, "key": "pricing", "title": "Extracting features and pricing", "detail": "Analyzing pricing tiers, specifications, and plans"},
    {"stage": 6, "key": "segments", "title": "Identifying target customer segments", "detail": "Profiling ICP, buyer personas, and decision makers"},
    {"stage": 7, "key": "objections", "title": "Analyzing customer pain points and objections", "detail": "Synthesizing objection battlecards and value pivots"},
    {"stage": 8, "key": "building", "title": "Building your Knowledge Capsules", "detail": "Structuring company-wide and product-level intelligence"},
    {"stage": 9, "key": "review", "title": "Preparing knowledge for review", "detail": "Finalizing version 1 draft for operator approval"}
]

class KnowledgeJobManager:
    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        # In-memory subscriber queues for SSE streams: job_id -> list of asyncio.Queue
        self._listeners: Dict[str, List[asyncio.Queue]] = {}
        # Cached in-memory status snapshots: job_id -> dict (bounded LRU)
        self._job_cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        # Active background tasks: job_id -> asyncio.Task
        self._active_tasks: Dict[str, asyncio.Task] = {}
        self._job_user_map: Dict[str, int] = {}
        # Owner of every job seen by this process (kept after the task ends so
        # status/stream endpoints can enforce ownership). Bounded LRU.
        self._job_owners: "OrderedDict[str, int]" = OrderedDict()
        self.engine = IntelligenceEngine()

    def _cleanup_task(self, job_id: str, task: Optional[asyncio.Task] = None):
        # Only forget the job if the finished task is still the registered one;
        # a re-sync registers a new task under the same id before the
        # cancelled one finishes.
        if task is not None and self._active_tasks.get(job_id) is not task:
            return
        self._active_tasks.pop(job_id, None)
        self._job_user_map.pop(job_id, None)

    def _remember_owner(self, job_id: str, user_id: int):
        self._job_owners[job_id] = user_id
        self._job_owners.move_to_end(job_id)
        while len(self._job_owners) > MAX_CACHED_JOBS:
            self._job_owners.popitem(last=False)

    def get_job_owner(self, job_id: str) -> Optional[int]:
        return self._job_owners.get(job_id)

    def is_job_active(self, job_id: str) -> bool:
        task = self._active_tasks.get(job_id)
        return bool(task and not task.done())

    def active_job_count(self, user_id: int) -> int:
        return sum(
            1 for jid, uid in list(self._job_user_map.items())
            if uid == user_id and self.is_job_active(jid)
        )

    def cancel_job(self, job_id: str):
        task = self._active_tasks.pop(job_id, None)
        self._job_user_map.pop(job_id, None)
        if task and not task.done():
            task.cancel()
            print(f"[KnowledgeJobManager] Cancelled task for job {job_id}")

    def cancel_user_jobs(self, user_id: int):
        jobs_to_cancel = [jid for jid, uid in list(self._job_user_map.items()) if uid == user_id]
        for jid in jobs_to_cancel:
            self.cancel_job(jid)

    @staticmethod
    def _source_still_wanted(db: Session, job_id: str) -> bool:
        """False once the source row was deleted / reset, or the import was cancelled (marked
        failed) while this task was working."""
        row = db.query(KnowledgeSource.status).filter(KnowledgeSource.id == job_id).first()
        return row is not None and row[0] != "failed"

    async def cancel_import(self, db: Session, job_id: str, source: Optional[KnowledgeSource]) -> bool:
        """Stop an import (keeping its source row and whatever it already stored), mark the
        source failed with ``CANCELLED_IMPORT_ERROR`` and end its streams. Returns whether a
        running task was cancelled."""
        was_running = self.is_job_active(job_id)
        self.cancel_job(job_id)
        if source is not None:
            source.status = "failed"
            source.error_message = CANCELLED_IMPORT_ERROR
            db.commit()
        await self.emit_job_event(job_id, {
            "stage": -1, "status": "failed", "progress": 0, "cancelled": True,
            "error": CANCELLED_IMPORT_ERROR, "message": CANCELLED_IMPORT_ERROR,
        })
        return was_running

    def get_cached_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._job_cache.get(job_id)

    def _register_task(self, job_id: str, user_id: int, task: asyncio.Task):
        self._active_tasks[job_id] = task
        self._job_user_map[job_id] = user_id
        self._remember_owner(job_id, user_id)
        task.add_done_callback(lambda t: self._cleanup_task(job_id, t))

    async def _handle_cancellation(self, job_id: str):
        """Tell stream listeners the job ended — unless a newer task (re-sync)
        has taken over this job id, or ``cancel_import`` already sent the
        cancelled event (one terminal event per cancel, in its wording)."""
        current = self._active_tasks.get(job_id)
        if current is not None and current is not asyncio.current_task():
            return
        last = self._job_cache.get(job_id)
        if last and last.get("cancelled"):
            return
        await self.emit_job_event(job_id, {
            "stage": -1, "status": "failed", "progress": 0, "cancelled": True,
            "error": "Ingestion was cancelled.", "message": "Ingestion was cancelled.",
        })

    def subscribe(self, job_id: str) -> asyncio.Queue:
        q = asyncio.Queue()
        if job_id not in self._listeners:
            self._listeners[job_id] = []
        self._listeners[job_id].append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue):
        if job_id in self._listeners and q in self._listeners[job_id]:
            self._listeners[job_id].remove(q)
            if not self._listeners[job_id]:
                del self._listeners[job_id]

    async def emit_job_event(self, job_id: str, event_data: Dict[str, Any]):
        """Publish event to all active SSE queues for this job and update cache."""
        event_data["timestamp"] = datetime.utcnow().isoformat()
        self._job_cache[job_id] = event_data
        self._job_cache.move_to_end(job_id)
        while len(self._job_cache) > MAX_CACHED_JOBS:
            self._job_cache.popitem(last=False)

        if job_id in self._listeners:
            for q in list(self._listeners[job_id]):
                try:
                    await q.put(event_data)
                except Exception:
                    pass

    async def start_website_ingestion_job(
        self,
        job_id: str,
        user_id: int,
        website_url: str
    ):
        """Asynchronously executes the full 9-stage website crawl and intelligence pipeline."""
        # Cancel any previous job for same ID if active
        self.cancel_job(job_id)
        task = asyncio.create_task(self._run_website_pipeline(job_id, user_id, website_url))
        self._register_task(job_id, user_id, task)

    async def start_document_ingestion_job(
        self,
        job_id: str,
        user_id: int,
        files_data: List[tuple[str, bytes]]
    ):
        """Asynchronously processes uploaded documents and generates capsules."""
        self.cancel_job(job_id)
        task = asyncio.create_task(self._run_document_pipeline(job_id, user_id, files_data))
        self._register_task(job_id, user_id, task)

    async def _run_website_pipeline(self, job_id: str, user_id: int, website_url: str):
        db: Session = SessionLocal()
        source = None
        try:
            source = db.query(KnowledgeSource).filter(KnowledgeSource.id == job_id).first()
            if not source:
                source = KnowledgeSource(
                    id=job_id,
                    user_id=user_id,
                    source_type="website",
                    title=website_url.replace("https://", "").replace("http://", "").split("/")[0],
                    source_url=website_url,
                    status="connecting"
                )
                db.add(source)
                db.commit()
            else:
                # Re-sync: this run starts afresh (a previous failure / cancel no longer applies).
                source.status = "connecting"
                source.error_message = None
                db.commit()

            # STAGE 1: Connecting
            await self.emit_job_event(job_id, {
                "stage": 1, "status": "running", "progress": 10,
                "title": STAGES[0]["title"], "message": f"Establishing connection with {website_url}...",
                "stages": STAGES
            })
            await asyncio.sleep(0.4)

            # STAGE 2: Discovering & Crawling
            await self.emit_job_event(job_id, {
                "stage": 2, "status": "running", "progress": 20,
                "title": STAGES[1]["title"], "message": "Discovering sitemap and scanning internal pages..."
            })

            crawler = WebsiteCrawler(
                base_url=website_url,
                max_pages=18,
                event_callback=lambda evt: self._handle_crawler_event(job_id, evt)
            )

            crawled_pages = await crawler.crawl()

            # Persist pages in DB
            db_pages = []
            for p in crawled_pages:
                kp = KnowledgePage(
                    source_id=job_id,
                    url=p["url"],
                    title=p["title"],
                    clean_text=p["clean_text"],
                    page_type=p.get("page_type", "general"),
                    status=p["status"],
                    http_status=p.get("http_status", 200),
                    error_message=p.get("error_message")
                )
                db.add(kp)
                db_pages.append(kp)

            processed_pages = [p for p in crawled_pages if p.get("status") == "processed" and len(p.get("clean_text", "")) >= 40]
            source.pages_discovered = len(crawled_pages)
            source.pages_processed = len(processed_pages)

            if not processed_pages:
                failed_reasons = set(p.get("error_message") or f"HTTP {p.get('http_status')}" for p in crawled_pages if p.get("error_message") or p.get("http_status"))
                reasons_str = ", ".join(failed_reasons) if failed_reasons else "Access denied or content blocked"
                err_msg = f"Could not extract content from website ({reasons_str}). The server blocked automated requests or rate-limited the connection. Please upload a business document or PDF instead."
                source.status = "failed"
                source.error_message = err_msg
                db.commit()

                await self.emit_job_event(job_id, {
                    "stage": 2,
                    "status": "failed",
                    "progress": 25,
                    "title": "Website Crawl Blocked",
                    "error": err_msg,
                    "message": err_msg
                })
                return

            # Verify source still exists before proceeding (avoids race condition if deleted/reset/cancelled)
            if not self._source_still_wanted(db, job_id):
                print(f"[Knowledge Pipeline Cancelled] Source {job_id} was removed or cancelled.")
                return

            source.status = "extracting"
            db.commit()

            # STAGES 3-7: Deep Multi-Pass Intelligence Extraction with Pacing
            async def extraction_notifier(evt: Dict[str, Any]):
                stage_idx = min(evt.get("stage", 3), len(STAGES))
                stage_info = STAGES[stage_idx - 1] if 1 <= stage_idx <= len(STAGES) else STAGES[2]
                await self.emit_job_event(job_id, {
                    "stage": evt.get("stage", 3),
                    "status": "running",
                    "progress": evt.get("progress", 50),
                    "title": stage_info["title"],
                    "message": evt.get("message", "Synthesizing deep business intelligence...")
                })

            # Run Multi-Pass Extraction Engine on processed pages
            intel_data = await self.engine.extract_structured_intelligence(
                processed_pages,
                notifier=extraction_notifier
            )

            # STAGE 8: Building Knowledge Capsules
            await self.emit_job_event(job_id, {
                "stage": 8, "status": "running", "progress": 92,
                "title": STAGES[7]["title"], "message": "Generating Company Capsule & Product Capsules..."
            })

            if not self._source_still_wanted(db, job_id):
                print(f"[Knowledge Pipeline Cancelled] Source {job_id} was removed or cancelled before saving capsules.")
                return

            merge_report: Dict[str, Any] = {}
            created_capsules = self._persist_capsules_and_facts(
                db, user_id, website_url, intel_data, crawled_pages, source_id=job_id, merge_report=merge_report
            )

            # STAGE 9: Ready for Review
            source.status = "completed"
            db.commit()

            await self.emit_job_event(job_id, {
                "stage": 9, "status": "completed", "progress": 100,
                "title": STAGES[8]["title"],
                "message": f"Successfully synthesized {len(created_capsules)} Capsules with verified facts.",
                "capsules": [
                    {"id": c.id, "name": c.name, "type": c.capsule_type, "product_name": c.product_name}
                    for c in created_capsules
                ],
                "knowledge_merge": merge_report,
            })

        except asyncio.CancelledError:
            print(f"[Knowledge Pipeline Cancelled] Task for {job_id} was cancelled.")
            try:
                db.rollback()
            except Exception:
                pass
            await self._handle_cancellation(job_id)
            return
        except Exception as e:
            print(f"[Knowledge Pipeline Failed] {e}")
            try:
                db.rollback()
                active_source = db.query(KnowledgeSource).filter(KnowledgeSource.id == job_id).first()
                if active_source:
                    active_source.status = "failed"
                    active_source.error_message = str(e)
                    db.commit()
            except Exception as db_err:
                print(f"[Knowledge Pipeline DB Recovery Failed] {db_err}")
                try:
                    db.rollback()
                except Exception:
                    pass
            await self.emit_job_event(job_id, {
                "stage": -1, "status": "failed", "progress": 0,
                "error": str(e), "message": f"Pipeline halted: {str(e)}"
            })
        finally:
            try:
                db.close()
            except Exception:
                pass

    async def _run_document_pipeline(
        self,
        job_id: str,
        user_id: int,
        files_data: List[tuple[str, bytes]]
    ):
        db: Session = SessionLocal()
        source = None
        try:
            filenames = [fn for fn, _ in files_data]
            source = KnowledgeSource(
                id=job_id,
                user_id=user_id,
                source_type="document",
                title=", ".join(filenames)[:50],
                status="extracting",
                pages_discovered=len(files_data),
                metadata_info={"files": filenames}
            )
            db.add(source)
            db.commit()

            await self.emit_job_event(job_id, {
                "stage": 1, "status": "running", "progress": 15,
                "title": "Parsing Uploaded Documents",
                "message": f"Reading {len(files_data)} business documents..."
            })

            corpus_pages = []
            parse_errors: List[str] = []
            for fname, fbytes in files_data:
                # PDF/DOCX/XLSX parsing is CPU-bound: run it off the event loop.
                try:
                    parsed = await asyncio.to_thread(parse_uploaded_file, fbytes, fname)
                except ValueError as parse_err:
                    # One unreadable file must not sink the whole batch.
                    parse_errors.append(str(parse_err))
                    db.add(KnowledgePage(
                        source_id=job_id,
                        url=f"document://{fname}",
                        title=fname,
                        clean_text="",
                        page_type="document",
                        status="failed",
                        http_status=422,
                        error_message=str(parse_err)[:500],
                    ))
                    continue
                kp = KnowledgePage(
                    source_id=job_id,
                    url=f"document://{fname}",
                    title=fname,
                    clean_text=parsed["clean_text"],
                    page_type="document",
                    status="processed"
                )
                db.add(kp)
                corpus_pages.append({
                    "url": f"document://{fname}",
                    "title": fname,
                    "clean_text": parsed["clean_text"],
                    "page_type": "document",
                    "status": "processed"
                })

            source.pages_processed = len(corpus_pages)
            db.commit()

            if not corpus_pages:
                raise ValueError("; ".join(parse_errors) or "No readable text found in the uploaded documents.")

            async def doc_notifier(evt: Dict[str, Any]):
                await self.emit_job_event(job_id, {
                    "stage": evt.get("stage", 4),
                    "status": "running",
                    "progress": evt.get("progress", 50),
                    "title": "Extracting Structured Business Truth",
                    "message": evt.get("message", "Synthesizing documentation intelligence...")
                })

            intel_data = await self.engine.extract_structured_intelligence(corpus_pages, notifier=doc_notifier)

            await self.emit_job_event(job_id, {
                "stage": 8, "status": "running", "progress": 85,
                "title": "Structuring Reviewable Capsules",
                "message": "Building product capsules from documentation..."
            })

            if not self._source_still_wanted(db, job_id):
                print(f"[Document Pipeline Cancelled] Source {job_id} was removed or cancelled.")
                return

            merge_report: Dict[str, Any] = {}
            created_capsules = self._persist_capsules_and_facts(
                db, user_id, f"document://{filenames[0]}", intel_data, corpus_pages,
                source_id=job_id, merge_report=merge_report,
            )

            source.status = "completed"
            db.commit()

            await self.emit_job_event(job_id, {
                "stage": 9, "status": "completed", "progress": 100,
                "title": "Documentation Intelligence Ready",
                "message": f"Prepared {len(created_capsules)} reviewable Capsules.",
                "capsules": [
                    {"id": c.id, "name": c.name, "type": c.capsule_type, "product_name": c.product_name}
                    for c in created_capsules
                ],
                "knowledge_merge": merge_report,
                "skipped_files": parse_errors,
            })

        except asyncio.CancelledError:
            print(f"[Document Pipeline Cancelled] Task for {job_id} was cancelled.")
            try:
                db.rollback()
            except Exception:
                pass
            await self._handle_cancellation(job_id)
            return
        except Exception as e:
            print(f"[Document Pipeline Failed] {e}")
            try:
                db.rollback()
                active_source = db.query(KnowledgeSource).filter(KnowledgeSource.id == job_id).first()
                if active_source:
                    active_source.status = "failed"
                    active_source.error_message = str(e)
                    db.commit()
            except Exception as db_err:
                print(f"[Document Pipeline Recovery Error] {db_err}")
                try:
                    db.rollback()
                except Exception:
                    pass
            await self.emit_job_event(job_id, {
                "stage": -1, "status": "failed", "progress": 0,
                "error": str(e), "message": f"Document extraction failed: {str(e)}"
            })
        finally:
            try:
                db.close()
            except Exception:
                pass

    def _persist_capsules_and_facts(
        self,
        db: Session,
        user_id: int,
        source_url: str,
        intel: Dict[str, Any],
        pages: List[Dict[str, Any]],
        source_id: Optional[str] = None,
        merge_report: Optional[Dict[str, Any]] = None,
    ) -> List[Capsule]:
        """
        Creates Company Capsule and Product Capsule(s) plus fine-grained facts and versioning.
        Preserves complete backward compatibility with existing Capsule schema.

        Merge-by-source: earlier knowledge is kept. Only unreviewed drafts that a
        previous ingestion of the SAME source produced are superseded (see
        ``_supersede_previous_drafts``). ``merge_report`` (if given) is filled
        with what happened.
        """
        biz = intel.get("business_intelligence", {}) if isinstance(intel, dict) else {}
        if isinstance(biz, list):
            biz = biz[0] if (biz and isinstance(biz[0], dict)) else {}
        elif not isinstance(biz, dict):
            biz = {}

        prods_raw = intel.get("products", []) if isinstance(intel, dict) else []
        if isinstance(prods_raw, dict):
            prods = [prods_raw]
        elif isinstance(prods_raw, list):
            prods = []
            for p in prods_raw:
                if isinstance(p, dict):
                    prods.append(p)
                elif isinstance(p, str) and p:
                    prods.append({"product_name": p, "description": p, "pricing_and_plans": "Contact Sales"})
        else:
            prods = []

        cust = intel.get("customer_intelligence", {}) if isinstance(intel, dict) else {}
        if isinstance(cust, list):
            cust = cust[0] if (cust and isinstance(cust[0], dict)) else {}
        elif not isinstance(cust, dict):
            cust = {}

        sales = intel.get("sales_intelligence", {}) if isinstance(intel, dict) else {}
        if isinstance(sales, list):
            sales = sales[0] if (sales and isinstance(sales[0], dict)) else {}
        elif not isinstance(sales, dict):
            sales = {}

        c_name = biz.get("company_name", {}) if isinstance(biz, dict) else {}
        company_name = c_name.get("value") if isinstance(c_name, dict) else (str(c_name) if c_name else "My Company")
        company_name = company_name or "My Company"

        b_desc = biz.get("business_description", {}) if isinstance(biz, dict) else {}
        company_desc = b_desc.get("value") if isinstance(b_desc, dict) else (str(b_desc) if b_desc else "")
        company_desc = company_desc or ""

        b_tone = biz.get("brand_tone", {}) if isinstance(biz, dict) else {}
        brand_tone = b_tone.get("value") if isinstance(b_tone, dict) else (str(b_tone) if b_tone else "Consultative & Professional")
        brand_tone = brand_tone or "Consultative & Professional"

        diff_obj = biz.get("key_differentiators", {}) if isinstance(biz, dict) else {}
        differentiators = diff_obj.get("value") if isinstance(diff_obj, dict) else (str(diff_obj) if diff_obj else "")
        differentiators = differentiators or ""

        t_segs = cust.get("target_segments", []) if isinstance(cust, dict) else []
        if isinstance(t_segs, list):
            target_audience_str = ", ".join(str(s) for s in t_segs if s) or "B2B Decision Makers"
        else:
            target_audience_str = str(t_segs) or "B2B Decision Makers"

        p_points = cust.get("pain_points", []) if isinstance(cust, dict) else []
        if isinstance(p_points, list):
            pain_points_list = [p.get("problem", "") if isinstance(p, dict) else str(p) for p in p_points]
        else:
            pain_points_list = [str(p_points)]
        pain_points_str = "\n".join(f"- {p}" for p in pain_points_list if p)

        created_capsules = []

        # Merge-by-source (replaces the old "delete every capsule whose company
        # name matches", which wiped earlier knowledge, published capsules and
        # user edits whenever more knowledge was added for the same company).
        superseded, preserved = self._supersede_previous_drafts(db, user_id, source_id, source_url)
        if merge_report is not None:
            merge_report.update({
                "strategy": KNOWLEDGE_MERGE_STRATEGY,
                "superseded_capsule_ids": superseded,
                "preserved_capsule_ids": preserved,
            })

        # 1. COMPANY CAPSULE (Shared context)
        company_capsule = Capsule(
            user_id=user_id,
            name=f"{company_name} — Company Overview",
            product_name=company_name,
            product_price="Company-wide context",
            product_specification=company_desc,
            target_audience=target_audience_str,
            key_differentiators=differentiators,
            pain_points_solved=pain_points_str,
            additional_context=json.dumps(sales.get("sales_talking_points", []) if isinstance(sales, dict) else []),
            capsule_type="company",
            company_name=company_name,
            brand_tone=brand_tone,
            version=1,
            status="draft",
            intelligence_data={
                "source_url": source_url,
                "source_id": source_id,
                "business_intelligence": biz,
                "customer_intelligence": cust,
                "sales_intelligence": sales
            }
        )
        db.add(company_capsule)
        db.flush()
        created_capsules.append(company_capsule)

        # 2. PRODUCT CAPSULES (Individual products)
        for p in prods:
            if not isinstance(p, dict):
                continue
            p_name = p.get("product_name") or f"{company_name} Solution"
            p_desc = p.get("description") or company_desc
            p_price = p.get("pricing_and_plans") or "Custom Quote"
            features = p.get("features", []) if isinstance(p.get("features"), list) else []
            benefits = p.get("benefits", []) if isinstance(p.get("benefits"), list) else []
            specs_combined = f"Features:\n" + "\n".join(f"- {f}" for f in features)
            if benefits:
                specs_combined += "\n\nBenefits:\n" + "\n".join(f"- {b}" for b in benefits)

            prod_capsule = Capsule(
                user_id=user_id,
                name=f"{p_name}",
                product_name=p_name,
                product_price=p_price,
                product_specification=specs_combined,
                target_audience=target_audience_str,
                key_differentiators=differentiators,
                pain_points_solved=pain_points_str,
                additional_context=json.dumps({
                    "source_url": source_url,
                    "faqs": p.get("product_faqs", []) if isinstance(p.get("product_faqs"), list) else [],
                    "integrations": p.get("integrations", []) if isinstance(p.get("integrations"), list) else [],
                    "use_cases": p.get("use_cases", []) if isinstance(p.get("use_cases"), list) else []
                }),
                capsule_type="product",
                company_name=company_name,
                brand_tone=brand_tone,
                version=1,
                status="draft",
                intelligence_data={"source_url": source_url, "source_id": source_id, "product": p, "sales": sales}
            )
            db.add(prod_capsule)
            db.flush()
            created_capsules.append(prod_capsule)

        # 3. Create Version Records for each capsule
        for c in created_capsules:
            v = CapsuleVersion(
                capsule_id=c.id,
                version_number=1,
                source_snapshot={
                    "source_url": source_url,
                    "extracted_at": datetime.utcnow().isoformat(),
                    "capsule_data": {
                        "name": c.name,
                        "product_name": c.product_name,
                        "product_price": c.product_price,
                        "specs": c.product_specification
                    }
                },
                approval_status="draft",
                change_summary="Initial automated crawl & intelligence extraction"
            )
            db.add(v)

            # 4. Create KnowledgeFact records for granular fact-level review
            self._insert_capsule_facts(db, user_id, c.id, intel, source_url)

        # 5. Create KnowledgeChunks for hybrid search
        for p in pages:
            if isinstance(p, dict):
                chunk = KnowledgeChunk(
                    user_id=user_id,
                    capsule_id=company_capsule.id,
                    category="web_page",
                    content=f"Page: {p.get('title', '')}\nURL: {p.get('url', '')}\n\n{(p.get('clean_text') or '')[:1200]}",
                    source_url=p.get("url")
                )
                db.add(chunk)

        db.commit()
        return created_capsules

    def _supersede_previous_drafts(
        self,
        db: Session,
        user_id: int,
        source_id: Optional[str],
        source_url: Optional[str],
    ) -> Tuple[List[int], List[int]]:
        """Remove only replaceable capsules from an earlier ingestion of the
        same source and return (superseded_ids, preserved_same_source_ids).

        Same source = same KnowledgeSource id (re-sync) or the same source URL
        (the same website / document name ingested again). A same-source
        capsule is replaced only when it is still an unreviewed ``draft``, has
        no user-confirmed facts and is not bound to a Pearl agent. Capsules
        from other sources and manual capsules are never touched.
        """
        candidates = db.query(Capsule).filter(
            Capsule.user_id == user_id,
            Capsule.capsule_type.in_(("company", "product")),
        ).all()
        same_source = []
        for c in candidates:
            intel = c.intelligence_data if isinstance(c.intelligence_data, dict) else {}
            if (source_id and intel.get("source_id") == source_id) or (source_url and intel.get("source_url") == source_url):
                same_source.append(c)
        if not same_source:
            return [], []

        ids = [c.id for c in same_source]
        user_edited = {
            cid for (cid,) in db.query(KnowledgeFact.capsule_id).filter(
                KnowledgeFact.capsule_id.in_(ids),
                KnowledgeFact.inference_type == "user_confirmed",
            ).distinct()
        }
        bound = set()
        try:
            from models_pearl import PearlAgent
            bound = {
                cid for (cid,) in db.query(PearlAgent.capsule_id).filter(PearlAgent.capsule_id.in_(ids)).distinct()
            }
        except Exception:
            bound = set(ids)  # cannot tell → treat as in use, keep them

        superseded = [
            c.id for c in same_source
            if (c.status or "draft") == "draft" and c.id not in user_edited and c.id not in bound
        ]
        preserved = [cid for cid in ids if cid not in superseded]
        if superseded:
            db.query(CapsuleVersion).filter(CapsuleVersion.capsule_id.in_(superseded)).delete(synchronize_session=False)
            db.query(KnowledgeFact).filter(KnowledgeFact.capsule_id.in_(superseded)).delete(synchronize_session=False)
            db.query(KnowledgeChunk).filter(KnowledgeChunk.capsule_id.in_(superseded)).delete(synchronize_session=False)
            db.query(Capsule).filter(Capsule.id.in_(superseded), Capsule.user_id == user_id).delete(synchronize_session=False)
            db.flush()
        return superseded, preserved

    def _insert_capsule_facts(
        self,
        db: Session,
        user_id: int,
        capsule_id: int,
        intel: Dict[str, Any],
        source_url: str
    ):
        biz = intel.get("business_intelligence", {}) if isinstance(intel, dict) else {}
        if isinstance(biz, list):
            biz = biz[0] if (biz and isinstance(biz[0], dict)) else {}
        elif not isinstance(biz, dict):
            biz = {}

        cust = intel.get("customer_intelligence", {}) if isinstance(intel, dict) else {}
        if isinstance(cust, list):
            cust = cust[0] if (cust and isinstance(cust[0], dict)) else {}
        elif not isinstance(cust, dict):
            cust = {}

        # Business facts
        for key, item in biz.items():
            if isinstance(item, dict) and item.get("value"):
                fact = KnowledgeFact(
                    user_id=user_id,
                    capsule_id=capsule_id,
                    category="business",
                    field_name=key.replace("_", " ").title(),
                    value=str(item["value"]),
                    source_url=source_url,
                    source_excerpt=item.get("source_excerpt"),
                    confidence=float(item.get("confidence", 0.9)),
                    inference_type=item.get("inference_type", "observed_fact"),
                    approval_status="approved"
                )
                db.add(fact)
            elif isinstance(item, str) and item:
                fact = KnowledgeFact(
                    user_id=user_id,
                    capsule_id=capsule_id,
                    category="business",
                    field_name=key.replace("_", " ").title(),
                    value=item,
                    source_url=source_url,
                    confidence=0.9,
                    inference_type="observed_fact",
                    approval_status="approved"
                )
                db.add(fact)

        # Objection facts
        pot_objs = cust.get("potential_objections", []) if isinstance(cust, dict) else []
        if isinstance(pot_objs, list):
            for obj in pot_objs:
                if isinstance(obj, dict) and obj.get("objection"):
                    val = f"Objection: {obj['objection']}\nPivot: {obj.get('suggested_pivot', '')}"
                    fact = KnowledgeFact(
                        user_id=user_id,
                        capsule_id=capsule_id,
                        category="sales",
                        field_name="Objection Handler",
                        value=val,
                        source_url=source_url,
                        confidence=float(obj.get("confidence", 0.85)),
                        inference_type=obj.get("inference_type", "ai_inference"),
                        approval_status="approved"
                    )
                    db.add(fact)

    async def _handle_crawler_event(self, job_id: str, evt: Dict[str, Any]):
        """Forward crawler micro-events to SSE subscribers."""
        await self.emit_job_event(job_id, {
            "stage": 2,
            "status": "crawling",
            "progress": min(35, 10 + evt.get("pages_processed", 0) * 2),
            "title": STAGES[1]["title"],
            "message": evt.get("message", "Reading website..."),
            "current_url": evt.get("url"),
            "pages_discovered": evt.get("pages_discovered", 0),
            "pages_processed": evt.get("pages_processed", 0)
        })
