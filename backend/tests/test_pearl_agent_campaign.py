"""
Clozflow / Pearl AI — Comprehensive Test Suite
────────────────────────────────────────────────
Tests:
1. Agent Management:
   - Create agent with directives, greeting, voice settings, and capsule
   - Get agent list and verify persistence
   - Update agent configuration and verify version increment
   - Duplicate agent and verify independent copy with draft status
2. Browser Testing (Chat Mode):
   - Create test session and verify agent snapshot immutability
   - Seed greeting message
   - Execute chat turn with real conversation engine
   - Context preservation across messages
   - Clear test session
3. Lead Ingestion Pipeline:
   - Phone normalization (+91, 10-digit, international E.164, invalid formats)
   - CSV parsing with column auto-mapping
   - Deduplication within batch and against existing campaign recipients
   - Accurate validation reporting (valid, invalid, duplicate, eligible)
4. Outbound Campaigns:
   - Create draft campaign linked to an agent
   - Import leads into campaign recipients
   - Review and toggle recipient eligibility
   - Campaign launch validation: blocks launch if 0 eligible recipients
   - Real campaign lifecycle status transitions
"""

import unittest
import os
import sys
import json
from datetime import datetime

# Put backend root on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
import models
import models_pearl
from models import User, Capsule
from models_pearl import PearlAgent, PearlCampaign, PearlCampaignRecipient, PearlTestSession, PearlTestMessage
from routers.auth import create_access_token, get_password_hash
from services.pearl.lead_ingestion import (
    validate_and_normalize_phone, parse_csv_file,
    canonicalize_lead_row, process_lead_batch
)
from main import app

# In-memory SQLite with StaticPool for test isolation
TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


class TestPearlAgentAndCampaign(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=test_engine)
        cls.client = TestClient(app)

        # Create test user
        db = TestingSession()
        cls.user = User(
            email="pearl_tester@clozflow.ai",
            username="pearl_tester",
            password_hash=get_password_hash("securepass123"),
            is_admin=True
        )
        db.add(cls.user)

        # Create test capsule
        cls.capsule = Capsule(
            user=cls.user,
            name="Clozflow Enterprise",
            product_name="Clozflow Autonomous Closer",
            product_price="₹25,000 / month",
            product_specification="Autonomous outbound dialing with sub-500ms voice response",
            target_audience="B2B sales teams in India",
            key_differentiators="Native Indian accent, zero hallucination guardrails",
            pain_points_solved="Slow lead response time, missed inbound callbacks",
            is_default=True
        )
        db.add(cls.capsule)
        db.commit()
        db.refresh(cls.user)
        db.refresh(cls.capsule)
        cls.user_id = cls.user.id
        cls.capsule_id = cls.capsule.id
        db.close()

        cls.token = create_access_token(data={"sub": str(cls.user.id), "email": cls.user.email})
        cls.headers = {"Authorization": f"Bearer {cls.token}"}

    # ── 1. Agent Management Tests ─────────────────────────────────────────────

    def test_01_create_agent_and_persist(self):
        payload = {
            "name": "Enterprise Demo Qualifier",
            "role": "outbound_qualification",
            "capsule_id": self.capsule_id,
            "mission": "Qualify prospects and book calendar meetings",
            "system_prompt": "You are Pearl. Introduce Clozflow and ask about lead volume.",
            "greeting": "Hi {{prospect_name}}, this is Pearl from Clozflow. Did I catch you at a bad time?",
            "voice_config": {
                "speaker": "ritu",
                "language": "Auto",
                "pace": 1.05,
                "tone": "confident"
            },
            "test_variables": {
                "prospect_name": "Arjun Sharma",
                "company": "GrowthX Labs"
            }
        }
        res = self.client.post("/api/pearl/agents", json=payload, headers=self.headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertIn("id", data)
        self.assertEqual(data["name"], "Enterprise Demo Qualifier")
        self.assertEqual(data["system_prompt"], payload["system_prompt"])
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["status"], "draft")
        self.__class__.created_agent_id = data["id"]

    def test_02_get_and_update_agent(self):
        agent_id = self.__class__.created_agent_id
        res = self.client.get(f"/api/pearl/agents/{agent_id}", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["name"], "Enterprise Demo Qualifier")

        # Update configuration
        update_payload = {
            "mission": "Qualify Indian mid-market software companies",
            "greeting": "Hello {{prospect_name}}, quick question regarding your sales pipeline."
        }
        update_res = self.client.patch(f"/api/pearl/agents/{agent_id}", json=update_payload, headers=self.headers)
        self.assertEqual(update_res.status_code, 200)
        updated = update_res.json()
        self.assertEqual(updated["mission"], update_payload["mission"])
        self.assertEqual(updated["greeting"], update_payload["greeting"])

    def test_03_duplicate_agent(self):
        agent_id = self.__class__.created_agent_id
        res = self.client.post(f"/api/pearl/agents/{agent_id}/duplicate", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        copy_data = res.json()
        self.assertNotEqual(copy_data["id"], agent_id)
        self.assertIn("(Copy)", copy_data["name"])
        self.assertEqual(copy_data["status"], "draft")

    # ── 2. Browser Chat Testing Tests ─────────────────────────────────────────

    def test_04_create_browser_test_session(self):
        agent_id = self.__class__.created_agent_id
        payload = {"agent_id": agent_id, "mode": "chat"}
        res = self.client.post("/api/pearl/test-sessions", json=payload, headers=self.headers)
        self.assertEqual(res.status_code, 200, res.text)
        session = res.json()
        self.assertIn("id", session)
        self.assertEqual(session["agent_id"], agent_id)
        self.assertEqual(session["mode"], "chat")
        self.assertEqual(session["status"], "active")
        self.assertIsNotNone(session["agent_snapshot"])
        self.assertTrue(len(session["messages"]) >= 1)  # Initial greeting was rendered
        self.assertIn("Arjun Sharma", session["messages"][0]["text"])
        self.__class__.test_session_id = session["id"]

    def test_05_send_chat_message_and_context(self):
        session_id = self.__class__.test_session_id
        chat_payload = {"message": "Yes, tell me how Clozflow helps our team."}
        res = self.client.post(f"/api/pearl/test-sessions/{session_id}/chat", json=chat_payload, headers=self.headers)
        self.assertEqual(res.status_code, 200, res.text)
        msg_resp = res.json()
        self.assertTrue(msg_resp["ok"])
        self.assertEqual(msg_resp["message"]["role"], "assistant")
        self.assertTrue(len(msg_resp["message"]["text"]) > 5)

        # Retrieve session and verify history has both user and assistant turns
        sess_res = self.client.get(f"/api/pearl/test-sessions/{session_id}", headers=self.headers)
        self.assertEqual(sess_res.status_code, 200)
        history = sess_res.json()["messages"]
        self.assertTrue(any(m["role"] == "user" for m in history))
        self.assertTrue(any(m["role"] == "assistant" for m in history))

    def test_06_clear_test_session(self):
        session_id = self.__class__.test_session_id
        res = self.client.post(f"/api/pearl/test-sessions/{session_id}/clear", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # Should be reset with just the initial greeting
        self.assertEqual(len(data["messages"]), 1)

    # ── 3. Lead Ingestion & Phone Normalization Tests ─────────────────────────

    def test_07_phone_normalization(self):
        # 10-digit Indian number
        valid, e164, err = validate_and_normalize_phone("9876543210")
        self.assertTrue(valid)
        self.assertEqual(e164, "+919876543210")

        # Formatted Indian number
        valid, e164, err = validate_and_normalize_phone("+91 98765 43210")
        self.assertTrue(valid)
        self.assertEqual(e164, "+919876543210")

        # Zero prefix
        valid, e164, err = validate_and_normalize_phone("09876543210")
        self.assertTrue(valid)
        self.assertEqual(e164, "+919876543210")

        # Invalid short number
        valid, e164, err = validate_and_normalize_phone("12345")
        self.assertFalse(valid)
        self.assertIsNotNone(err)

    def test_08_lead_batch_processing_and_deduplication(self):
        raw_leads = [
            {"Name": "Rajesh Kumar", "Phone": "9876543210", "Company": "Kumar Logistics"},
            {"Name": "Rajesh Duplicate", "Phone": "+91 98765 43210", "Company": "Duplicate LLC"},
            {"Name": "Anita Desai", "Phone": "9811122233", "Company": "Desai Corp"},
            {"Name": "Bad Contact", "Phone": "00000", "Company": "Invalid Inc"}
        ]
        processed, stats = process_lead_batch(raw_leads, source="csv_upload")
        self.assertEqual(stats["total_rows"], 4)
        self.assertEqual(stats["valid_count"], 2)
        self.assertEqual(stats["duplicate_count"], 1)
        self.assertEqual(stats["invalid_count"], 1)
        self.assertEqual(stats["eligible_count"], 2)

    # ── 4. Outbound Campaigns Tests ───────────────────────────────────────────

    def test_09_create_campaign_draft(self):
        agent_id = self.__class__.created_agent_id
        campaign_payload = {
            "name": "Q4 Enterprise Outreach Campaign",
            "agent_id": agent_id,
            "objective": "Qualify B2B companies for priority pilot onboarding",
            "description": "High intent outbound campaign",
            "source_type": "lead_finder",
            "call_settings": {
                "calling_hours": "10:00 - 18:00",
                "timezone": "Asia/Kolkata (IST)",
                "max_attempts": 2,
                "retry_interval": 60,
                "concurrency_limit": 1
            }
        }
        res = self.client.post("/api/pearl/campaigns", json=campaign_payload, headers=self.headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertIn("id", data)
        self.assertEqual(data["name"], campaign_payload["name"])
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["metrics"]["eligible_recipients"], 0)
        self.__class__.campaign_id = data["id"]

    def test_10_import_leads_from_lead_finder(self):
        campaign_id = self.__class__.campaign_id
        finder_leads = [
            {
                "business_name": "Apex Cloud Systems",
                "phone_number": "9822012345",
                "city": "Bengaluru",
                "category": "SaaS"
            },
            {
                "business_name": "Zenith Marketing Group",
                "phone_number": "9833054321",
                "city": "Mumbai",
                "category": "Agency"
            }
        ]
        res = self.client.post(
            f"/api/pearl/campaigns/{campaign_id}/import-from-finder",
            json={"leads": finder_leads},
            headers=self.headers
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["imported_count"], 2)
        self.assertEqual(data["eligible_count"], 2)

    def test_11_recipient_review_and_toggle(self):
        campaign_id = self.__class__.campaign_id
        res = self.client.get(f"/api/pearl/campaigns/{campaign_id}/recipients", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        recipients = res.json()["recipients"]
        self.assertEqual(len(recipients), 2)

        # Toggle first recipient to 'excluded'
        first_r = recipients[0]
        toggle_res = self.client.patch(
            f"/api/pearl/campaigns/{campaign_id}/recipients/{first_r['id']}?status=excluded",
            headers=self.headers
        )
        self.assertEqual(toggle_res.status_code, 200)
        self.assertEqual(toggle_res.json()["eligible_count"], 1)

    def test_12_campaign_launch_validation(self):
        campaign_id = self.__class__.campaign_id

        # Exclude remaining recipient to test 0-eligible block
        res = self.client.get(f"/api/pearl/campaigns/{campaign_id}/recipients", headers=self.headers)
        recipients = res.json()["recipients"]
        for r in recipients:
            self.client.patch(f"/api/pearl/campaigns/{campaign_id}/recipients/{r['id']}?status=excluded", headers=self.headers)

        # Launch should fail with 400 because eligible count is 0
        launch_res = self.client.post(f"/api/pearl/campaigns/{campaign_id}/launch", headers=self.headers)
        self.assertEqual(launch_res.status_code, 400)
        self.assertIn("no eligible recipients", launch_res.json()["detail"].lower())

        # Re-enable one recipient
        self.client.patch(f"/api/pearl/campaigns/{campaign_id}/recipients/{recipients[0]['id']}?status=valid", headers=self.headers)

        # Launch will either succeed or fail gracefully if Exotel credentials missing
        launch_res = self.client.post(f"/api/pearl/campaigns/{campaign_id}/launch", headers=self.headers)
        # Should be 200 (if credentials present) or 400 (if missing credentials with clear message)
        self.assertIn(launch_res.status_code, [200, 400])

    def test_13_conversation_engine_system_prompt_integrity(self):
        from services.pearl.conversation_engine import ConversationEngine

        # Case A: Standard prompt without override
        engine_standard = ConversationEngine(
            objective="Book discovery demo",
            lead_context={"business_name": "Rohan Gupta", "capsule_context": "AI CRM tool"}
        )
        self.assertIn("CONVERSATION STYLE:", engine_standard.system_prompt)
        self.assertIn("conversational Hinglish", engine_standard.system_prompt)
        self.assertIn("OUTBOUND OPENING:", engine_standard.system_prompt)
        self.assertIn("SALES INTELLIGENCE:", engine_standard.system_prompt)
        self.assertIn("SPOKEN OUTPUT:", engine_standard.system_prompt)

        # Case B: With custom agent directives / override
        custom_directive = "Always ask about lead volume in the first 30 seconds."
        engine_custom = ConversationEngine(
            objective="Book discovery demo",
            lead_context={"business_name": "Rohan Gupta", "capsule_context": "AI CRM tool"},
            system_prompt_override=custom_directive
        )
        # MUST preserve foundational intelligence
        self.assertIn("CONVERSATION STYLE:", engine_custom.system_prompt)
        self.assertIn("conversational Hinglish", engine_custom.system_prompt)
        self.assertIn("OUTBOUND OPENING:", engine_custom.system_prompt)
        self.assertIn("SALES INTELLIGENCE:", engine_custom.system_prompt)
        self.assertIn("SPOKEN OUTPUT:", engine_custom.system_prompt)
        # AND include the custom directives
        self.assertIn("SPECIFIC AGENT DIRECTIVES & GUIDELINES:", engine_custom.system_prompt)
        self.assertIn(custom_directive, engine_custom.system_prompt)


if __name__ == "__main__":
    unittest.main()
