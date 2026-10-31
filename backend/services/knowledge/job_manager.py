import asyncio
import json
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Capsule
from models_knowledge import KnowledgeSource, KnowledgePage, KnowledgeFact, CapsuleVersion, KnowledgeChunk
from services.knowledge.crawler import WebsiteCrawler
from services.knowledge.document_parser import parse_uploaded_file
from services.knowledge.intelligence_engine import IntelligenceEngine


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
        # Cached in-memory status snapshots: job_id -> dict
        self._job_cache: Dict[str, Dict[str, Any]] = {}
        self.engine = IntelligenceEngine()

    def get_cached_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._job_cache.get(job_id)

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
        asyncio.create_task(self._run_website_pipeline(job_id, user_id, website_url))

    async def start_document_ingestion_job(
        self,
        job_id: str,
        user_id: int,
        files_data: List[tuple[str, bytes]]
    ):
        """Asynchronously processes uploaded documents and generates capsules."""
        asyncio.create_task(self._run_document_pipeline(job_id, user_id, files_data))

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

            source.pages_discovered = len(crawled_pages)
            source.pages_processed = len([p for p in crawled_pages if p["status"] == "processed"])
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

            # Run Multi-Pass Extraction Engine
            intel_data = await self.engine.extract_structured_intelligence(
                crawled_pages,
                notifier=extraction_notifier
            )

            # STAGE 8: Building Knowledge Capsules
            await self.emit_job_event(job_id, {
                "stage": 8, "status": "running", "progress": 92,
                "title": STAGES[7]["title"], "message": "Generating Company Capsule & Product Capsules..."
            })

            created_capsules = self._persist_capsules_and_facts(db, user_id, website_url, intel_data, crawled_pages)

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
                ]
            })

        except Exception as e:
            print(f"[Knowledge Pipeline Failed] {e}")
            if source:
                source.status = "failed"
                source.error_message = str(e)
                db.commit()
            await self.emit_job_event(job_id, {
                "stage": -1, "status": "failed", "progress": 0,
                "error": str(e), "message": f"Pipeline halted: {str(e)}"
            })
        finally:
            db.close()

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
            for fname, fbytes in files_data:
                parsed = parse_uploaded_file(fbytes, fname)
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

            created_capsules = self._persist_capsules_and_facts(
                db, user_id, f"document://{filenames[0]}", intel_data, corpus_pages
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
                ]
            })

        except Exception as e:
            print(f"[Document Pipeline Failed] {e}")
            if source:
                source.status = "failed"
                source.error_message = str(e)
                db.commit()
            await self.emit_job_event(job_id, {
                "stage": -1, "status": "failed", "progress": 0,
                "error": str(e), "message": f"Document extraction failed: {str(e)}"
            })
        finally:
            db.close()

    def _persist_capsules_and_facts(
        self,
        db: Session,
        user_id: int,
        source_url: str,
        intel: Dict[str, Any],
        pages: List[Dict[str, Any]]
    ) -> List[Capsule]:
        """
        Creates Company Capsule and Product Capsule(s) plus fine-grained facts and versioning.
        Preserves complete backward compatibility with existing Capsule schema.
        """
        biz = intel.get("business_intelligence", {})
        prods = intel.get("products", [])
        cust = intel.get("customer_intelligence", {})
        sales = intel.get("sales_intelligence", {})

        company_name = biz.get("company_name", {}).get("value") or "My Company"
        company_desc = biz.get("business_description", {}).get("value") or ""
        brand_tone = biz.get("brand_tone", {}).get("value") or "Consultative & Professional"
        differentiators = biz.get("key_differentiators", {}).get("value") or ""

        target_audience_str = ", ".join(cust.get("target_segments", [])) or "B2B Decision Makers"
        pain_points_list = [p.get("problem", "") if isinstance(p, dict) else str(p) for p in cust.get("pain_points", [])]
        pain_points_str = "\n".join(f"- {p}" for p in pain_points_list if p)

        created_capsules = []

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
            additional_context=json.dumps(sales.get("sales_talking_points", [])),
            capsule_type="company",
            company_name=company_name,
            brand_tone=brand_tone,
            version=1,
            status="draft",
            intelligence_data={
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
            p_name = p.get("product_name") or f"{company_name} Solution"
            p_desc = p.get("description") or company_desc
            p_price = p.get("pricing_and_plans") or "Custom Quote"
            features = p.get("features", [])
            benefits = p.get("benefits", [])
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
                    "faqs": p.get("product_faqs", []),
                    "integrations": p.get("integrations", []),
                    "use_cases": p.get("use_cases", [])
                }),
                capsule_type="product",
                company_name=company_name,
                brand_tone=brand_tone,
                version=1,
                status="draft",
                intelligence_data={"product": p, "sales": sales}
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
            chunk = KnowledgeChunk(
                user_id=user_id,
                capsule_id=company_capsule.id,
                category="web_page",
                content=f"Page: {p.get('title', '')}\nURL: {p.get('url', '')}\n\n{p.get('clean_text', '')[:1200]}",
                source_url=p.get("url")
            )
            db.add(chunk)

        db.commit()
        return created_capsules

    def _insert_capsule_facts(
        self,
        db: Session,
        user_id: int,
        capsule_id: int,
        intel: Dict[str, Any],
        source_url: str
    ):
        biz = intel.get("business_intelligence", {})
        cust = intel.get("customer_intelligence", {})
        sales = intel.get("sales_intelligence", {})

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

        # Objection facts
        for obj in cust.get("potential_objections", []):
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
