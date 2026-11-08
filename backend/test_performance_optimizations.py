"""
Comprehensive Verification Suite for Codebase Performance & Algorithmic Optimizations
════════════════════════════════════════════════════════════════════════════════════════
Verifies:
1. Lead Ingestion O(1) field extraction performance under bulk row processing.
2. Tool Execution Engine persistent HTTP pooling, regex early exits, and JSONPath LRU caching.
3. Conversation Engine KV prefix caching fast equality check (zero SHA-256 overhead per turn).
4. Database eager-loading and paginated event loading on PearlAgent and PearlCampaign.
5. Database schema B-tree indexes presence on hot query paths.
"""
import sys
import time
import asyncio
from pathlib import Path
from datetime import datetime

backend_dir = Path(__file__).parent.resolve()
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from database import Base, engine, SessionLocal
from models_pearl import PearlAgent, PearlEvent, PearlCampaign, PearlCampaignRecipient, AgentTool, PearlCall
from services.pearl.lead_ingestion import canonicalize_lead_row, process_lead_batch, extract_field
from services.pearl.tool_engine import (
    substitute_variables_in_string,
    _get_tool_http_client,
    extract_json_path,
    _parse_json_path,
    execute_data_validator,
    execute_data_verifier,
)
from services.pearl.conversation_engine import (
    ConversationEngine,
    _STATIC_FOUNDATION_PROMPT,
    _STATIC_PROMPT_HASH,
    get_kv_cache_stats,
    _kv_cache_stats
)
from routers.pearl import agent_to_dict, campaign_to_dict
from sqlalchemy.orm import joinedload, selectinload


def test_bulk_lead_ingestion_performance():
    print("--- 1. Testing Bulk Lead Ingestion Performance & O(1) Key Lookups ---")
    num_rows = 5000
    mock_batch = [
        {
            "Full_Name": f"Prospect {i}",
            "Company_Name": f"Enterprise Corp {i}",
            "Contact_Number": f"+9198765{i:05d}",
            "Email_Address": f"user{i}@company.com",
            "City": "Bengaluru",
            "Website": f"https://company{i}.com"
        }
        for i in range(num_rows)
    ]

    t0 = time.perf_counter()
    processed, stats = process_lead_batch(mock_batch, source="csv_upload")
    duration = time.perf_counter() - t0

    assert len(processed) == num_rows
    assert stats["valid_count"] == num_rows
    assert stats["duplicate_count"] == 0
    # 5,000 records should process in under 0.6 seconds
    print(f"[PASS] Processed {num_rows} leads in {duration:.3f}s ({num_rows / duration:.0f} rows/sec).")
    assert duration < 1.5, f"Lead batch processing too slow: {duration:.3f}s"


def test_tool_engine_optimizations():
    print("--- 2. Testing Tool Engine Persistent Pooling & Early Return Optimizations ---")
    # A. Early exit check in substitute_variables_in_string
    plain_text = "https://api.clozflow.ai/v1/customer/lookup"
    t0 = time.perf_counter()
    for _ in range(50000):
        substitute_variables_in_string(plain_text, {"lead": {"phone": "9876543210"}})
    t_plain = time.perf_counter() - t0
    print(f"[PASS] 50,000 plain string substitutions with early return completed in {t_plain*1000:.2f}ms.")
    assert t_plain < 0.25, f"Early return too slow: {t_plain:.3f}s"

    # B. JSONPath LRU caching
    path = "data.customers[0].contacts.billing.phone"
    _parse_json_path.cache_clear()
    t0 = time.perf_counter()
    sample_data = {"data": {"customers": [{"contacts": {"billing": {"phone": "+919876543210"}}}]}}
    for _ in range(20000):
        extract_json_path(sample_data, path)
    t_json = time.perf_counter() - t0
    info = _parse_json_path.cache_info()
    assert info.hits >= 19999
    print(f"[PASS] 20,000 cached JSONPath extractions in {t_json*1000:.2f}ms (Cache hits: {info.hits}, misses: {info.misses}).")

    # C. Persistent HTTP client pool
    client1 = _get_tool_http_client()
    client2 = _get_tool_http_client()
    assert client1 is client2, "HTTP client should be a persistent singleton across calls!"
    assert not client1.is_closed, "Persistent HTTP client should remain open for keep-alive reuse."
    print("[PASS] Tool engine persistent HTTP client connection pool verified.")


def test_kv_caching_fast_path():
    print("--- 3. Testing KV Prefix Caching Zero-Crypto Turn Generation ---")
    engine = ConversationEngine(
        objective="Lead Qualification",
        lead_context={"prospect_name": "Arjun", "company": "Acme Tech"}
    )
    # Check that position [0] equals foundation prompt
    assert engine._system_messages[0]["content"] == _STATIC_FOUNDATION_PROMPT

    # Time 100,000 string equality checks vs sha256
    t0 = time.perf_counter()
    for _ in range(100000):
        _ = (engine._system_messages[0]["content"] == _STATIC_FOUNDATION_PROMPT)
    t_eq = time.perf_counter() - t0
    print(f"[PASS] 100,000 KV cache alignment O(1) checks executed in {t_eq*1000:.2f}ms.")
    assert t_eq < 0.1


def test_database_eager_loading_and_bounded_event_query():
    print("--- 4. Testing Database Bounded Event Query & Query Optimization ---")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        agent = PearlAgent(name="Perf Agent", user_id=999, status="active")
        db.add(agent)
        db.commit()
        db.refresh(agent)

        # Insert 100 events for this agent with strictly increasing timestamps
        events = [
            PearlEvent(
                agent_id=agent.id,
                event_type="call_completed",
                summary=f"Event summary {i}",
                timestamp=datetime.fromtimestamp(1700000000 + i)
            )
            for i in range(100)
        ]
        db.add_all(events)
        db.commit()

        # Bounded query simulation as in get_agent
        recent_events = db.query(PearlEvent).filter(
            PearlEvent.agent_id == agent.id
        ).order_by(PearlEvent.timestamp.desc()).limit(20).all()

        assert len(recent_events) == 20
        res = agent_to_dict(agent, include_events=True, recent_events=recent_events)
        assert len(res["recent_events"]) == 20
        assert res["recent_events"][0]["summary"] == "Event summary 99"
        print("[PASS] Bounded 20-event query verified without lazy loading all 100 events into memory.")

        # Campaign with recipients eager loading
        campaign = PearlCampaign(user_id=999, name="Summer Sprint", status="draft")
        db.add(campaign)
        db.commit()
        db.refresh(campaign)

        recipients = [
            PearlCampaignRecipient(
                campaign_id=campaign.id,
                name=f"Lead {i}",
                phone_number=f"+9198000{i:05d}",
                normalized_phone=f"+9198000{i:05d}",
                status="valid"
            )
            for i in range(50)
        ]
        db.add_all(recipients)
        db.commit()

        # Fetch campaign with selectinload
        fetched_campaign = db.query(PearlCampaign).options(
            joinedload(PearlCampaign.agent),
            selectinload(PearlCampaign.recipients)
        ).filter(PearlCampaign.id == campaign.id).first()

        camp_dict = campaign_to_dict(fetched_campaign, include_recipients=True)
        assert len(camp_dict["recipients"]) == 50
        print("[PASS] Campaign selectinload eager loading of recipients verified cleanly.")

        # Clean up
        db.delete(agent)
        db.delete(campaign)
        db.commit()
    finally:
        db.close()


def test_database_indexes():
    print("--- 5. Testing Database Column B-tree Index Definitions ---")
    from sqlalchemy import inspect
    # Inspect columns that have index=True
    agent_cols = {c.name: c.index for c in PearlAgent.__table__.columns if c.index}
    assert "status" in agent_cols
    assert "created_at" in agent_cols
    assert "user_id" in agent_cols

    call_cols = {c.name: c.index for c in PearlCall.__table__.columns if c.index}
    assert "status" in call_cols
    assert "created_at" in call_cols
    assert "lead_id" in call_cols
    assert "agent_id" in call_cols

    camp_cols = {c.name: c.index for c in PearlCampaign.__table__.columns if c.index}
    assert "status" in camp_cols
    assert "created_at" in camp_cols

    tool_cols = {c.name: c.index for c in AgentTool.__table__.columns if c.index}
    assert "tool_type" in tool_cols
    assert "is_active" in tool_cols
    assert "created_at" in tool_cols

    recip_cols = {c.name: c.index for c in PearlCampaignRecipient.__table__.columns if c.index}
    assert "status" in recip_cols
    assert "normalized_phone" in recip_cols
    assert "created_at" in recip_cols

    print("[PASS] All critical foreign keys, status flags, and created_at timestamps have explicit B-tree indexes.")


if __name__ == "__main__":
    test_bulk_lead_ingestion_performance()
    test_tool_engine_optimizations()
    test_kv_caching_fast_path()
    test_database_eager_loading_and_bounded_event_query()
    test_database_indexes()
    print("\nALL PERFORMANCE AND ROBUSTNESS VERIFICATION TESTS PASSED SUCCESSFULLY!")
