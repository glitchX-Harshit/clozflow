import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, Text, ForeignKey, Boolean, JSON
from sqlalchemy.orm import relationship
from database import Base

def generate_uuid():
    return str(uuid.uuid4())

class KnowledgeSource(Base):
    """
    Represents an ingested knowledge source (website crawl or uploaded document batch).
    """
    __tablename__ = "knowledge_sources"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id             = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_type         = Column(String, nullable=False)  # "website" | "document"
    title               = Column(String, nullable=False)
    source_url          = Column(String, nullable=True)
    status              = Column(String, default="idle")  # idle, connecting, crawling, extracting, completed, failed
    pages_discovered    = Column(Integer, default=0)
    pages_processed     = Column(Integer, default=0)
    error_message       = Column(Text, nullable=True)
    metadata_info       = Column(JSON, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    pages               = relationship("KnowledgePage", back_populates="source", cascade="all, delete-orphan")


class KnowledgePage(Base):
    """
    Individual webpage or document section extracted during ingestion.
    """
    __tablename__ = "knowledge_pages"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    source_id           = Column(String, ForeignKey("knowledge_sources.id"), nullable=False, index=True)
    url                 = Column(String, nullable=False)
    title               = Column(String, nullable=True)
    clean_text          = Column(Text, nullable=False)
    page_type           = Column(String, default="general") # homepage, product, pricing, about, faq, etc.
    status              = Column(String, default="processed") # processed, failed, excluded
    http_status         = Column(Integer, default=200)
    error_message       = Column(String, nullable=True)
    extracted_at        = Column(DateTime, default=datetime.utcnow)

    # Relationships
    source              = relationship("KnowledgeSource", back_populates="pages")


class KnowledgeFact(Base):
    """
    Structured business/product intelligence item extracted from knowledge sources.
    Distinguishes observed facts from AI inferences.
    """
    __tablename__ = "knowledge_facts"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id             = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    capsule_id          = Column(Integer, ForeignKey("capsules.id"), nullable=True, index=True)
    category            = Column(String, nullable=False) # business, product, customer, sales
    field_name          = Column(String, nullable=False) # e.g. company_name, pricing_tier, objection, etc.
    value               = Column(Text, nullable=False)
    source_url          = Column(String, nullable=True)
    source_excerpt      = Column(Text, nullable=True)
    confidence          = Column(Float, default=1.0)
    inference_type      = Column(String, default="observed_fact") # observed_fact, ai_inference, user_confirmed
    approval_status     = Column(String, default="approved")     # draft, approved, rejected
    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CapsuleVersion(Base):
    """
    Snapshot of a Capsule version for auditability and rollback.
    """
    __tablename__ = "capsule_versions"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    capsule_id          = Column(Integer, ForeignKey("capsules.id"), nullable=False, index=True)
    version_number      = Column(Integer, nullable=False)
    source_snapshot     = Column(JSON, nullable=True)
    approval_status     = Column(String, default="published") # draft, approved, published
    change_summary      = Column(Text, nullable=True)
    approved_by         = Column(String, nullable=True)
    approved_at         = Column(DateTime, default=datetime.utcnow)
    created_at          = Column(DateTime, default=datetime.utcnow)


class KnowledgeChunk(Base):
    """
    Text chunks indexed for hybrid vector/keyword search.
    """
    __tablename__ = "knowledge_chunks"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id             = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    capsule_id          = Column(Integer, ForeignKey("capsules.id"), nullable=True, index=True)
    category            = Column(String, default="general")
    content             = Column(Text, nullable=False)
    source_url          = Column(String, nullable=True)
    metadata_info       = Column(JSON, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)
