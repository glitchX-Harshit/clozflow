"""
Test Suite: Sage AI Agent Architect Service & Adaptive Call Cut Intelligence
═════════════════════════════════════════════════════════════════════════════
Verifies:
1. Sage service response generation, planning steps, and follow-up questions
2. Flexible rejection handling and call disconnection rules (no rigid 2-yes lock)
3. Dynamic agent configuration patch generation
4. Conversation Engine prompt builder with organic cadence (no hardcoded bridge words)
"""

import asyncio
import os
import sys

import pytest

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from services.pearl.sage_service import run_sage_conversation, _generate_heuristic_response, _build_context_summary
from services.pearl.conversation_engine import ConversationEngine


@pytest.fixture(autouse=True)
def _offline_sage(monkeypatch):
    """These tests assert on Sage's deterministic heuristic planner: never call the live LLM."""
    monkeypatch.delenv("GROQ_API_KEY", raising=False)


async def test_sage_heuristic_rejection_and_call_cut():
    print("Testing Sage Call Cut & Rejection Architecture...")
    agent_state = {
        "name": "B2B Qualifier",
        "role": "outbound_qualification",
        "mission": "Qualify prospects and book discovery walkthroughs.",
        "fine_tuning_directives": "Initial directives.",
        "greeting_enabled": False,
        "settings": {
            "callCutRule": "reframe_once_then_exit",
            "disconnectPhrase": "Bilkul samjha sir, thank you for your time. Have a great day!"
        }
    }

    # Query about call cut / rejection
    res = await run_sage_conversation(
        messages=[],
        query="When a prospect says they are not interested, when should the agent cut the call instead of 2-yes?",
        agent_state=agent_state
    )

    assert "steps" in res, "Response must include steps summary"
    assert "steps_detail" in res and len(res["steps_detail"]) >= 2, "Response must include detailed steps"
    assert "text" in res and len(res["text"]) > 10, "Response must include consultative opening"
    assert "body" in res and len(res["body"]) > 20, "Response must include explanatory body"
    assert "follow_up_questions" in res and len(res["follow_up_questions"]) > 0, "Must ask context-aware questions"
    assert "action_card" in res and res["action_card"], "Must include interactive action card"
    assert "options" in res["action_card"] and len(res["action_card"]["options"]) >= 2, "Action card must have options"
    assert "patch" in res and res["patch"], "Must include configuration patch"
    assert "settings" in res["patch"], "Patch should include telephony settings update"
    assert res["patch"]["settings"].get("callCutRule") == "reframe_once_then_exit"

    print("[PASS] Sage Call Cut & Rejection handling verified.")


async def test_sage_cold_call_and_tone():
    print("Testing Sage Cold Calling & Human Tone Configuration...")
    agent_state = {
        "name": "Sales Rep 101",
        "role": "cold_call",
        "voice_config": {"speaker": "shubh_enhi_ads", "language": "Auto"}
    }

    # Query about cold call setup
    res_cold = await run_sage_conversation(
        messages=[],
        query="Set up this agent for outbound cold calling",
        agent_state=agent_state
    )
    assert res_cold["patch"].get("greeting_enabled") is False, "Cold call agent should have fixed greeting disabled"

    # Query about human tone and natural Indian cadence
    res_tone = await run_sage_conversation(
        messages=[],
        query="Make the voice sound natural human like with Indian English and no canned bridge words",
        agent_state=agent_state
    )
    assert "bridge" in res_tone["body"].lower() or "filler" in res_tone["body"].lower() or "cadence" in res_tone["body"].lower()
    assert "voice_config" in res_tone["patch"] or "fine_tuning_directives" in res_tone["patch"]

    print("[PASS] Cold Calling & Human Tone Configuration verified.")


async def test_sage_multi_strategy_objection_and_call_cut():
    print("Testing Sage Multi-Strategy Objection & Call Cut (2-Yes, Immediate, Two-Touch)...")
    agent_state = {
        "name": "B2B Qualifier",
        "role": "outbound_qualification",
        "mission": "Qualify prospects and book discovery walkthroughs.",
        "fine_tuning_directives": "Initial directives.",
        "greeting_enabled": False,
        "settings": {
            "callCutRule": "reframe_once_then_exit",
            "disconnectPhrase": "Bilkul samjha sir, thank you for your time. Have a great day!"
        }
    }

    # 1. Exact user phrasing: "not everyone need 2 yes"
    res_2yes = await run_sage_conversation(
        messages=[],
        query="not everyone need 2 yes you know, make it disconnect when listening to rejection",
        agent_state=agent_state
    )
    assert res_2yes["patch"]["settings"].get("callCutRule") in ["reframe_once_then_exit", "immediate_disconnect"]
    assert "rejection" in res_2yes["body"].lower() or "exit" in res_2yes["body"].lower()

    # 2. Immediate Disconnect request
    res_imm = await run_sage_conversation(
        messages=[],
        query="Disconnect immediately on first rejection without pushback",
        agent_state=agent_state
    )
    assert res_imm["patch"]["settings"].get("callCutRule") == "immediate_disconnect", "Must set immediate_disconnect"
    assert "immediately" in res_imm["text"].lower() or "immediate" in res_imm["text"].lower()

    # 3. Two-Touch Reframe request
    res_two = await run_sage_conversation(
        messages=[],
        query="Push up to 2 times on objections before disconnecting",
        agent_state=agent_state
    )
    assert res_two["patch"]["settings"].get("callCutRule") == "two_touch_reframe", "Must set two_touch_reframe"

    # 4. Directive deduplication across multiple turns
    state_mut = {"fine_tuning_directives": "Initial directive line."}
    run1 = await run_sage_conversation(messages=[], query="objection handling", agent_state=state_mut)
    state_mut["fine_tuning_directives"] = run1["patch"]["fine_tuning_directives"]
    run2 = await run_sage_conversation(messages=[], query="rejection handling", agent_state=state_mut)
    dir_content = run2["patch"]["fine_tuning_directives"]
    assert dir_content.count("OBJECTION & DISCONNECTION HANDLING:") == 1, "Must not duplicate section header"

    print("[PASS] Multi-Strategy Objection & Call Cut verified cleanly.")


def test_conversation_engine_dynamic_prompt():
    print("Testing ConversationEngine System Prompt with Organic Cadence & Call-Cut...")
    
    # Test 1: Default reframe_once_then_exit
    engine_default = ConversationEngine(
        objective="Qualify lead",
        lead_context={"business_name": "Acme Corp", "agent_name": "Sage"},
        voice_config={
            "settings": {
                "callCutRule": "reframe_once_then_exit",
                "disconnectPhrase": "Bilkul samjha sir, thank you for your time. Have a great day!"
            }
        }
    )
    prompt_default = engine_default.system_prompt
    
    # Must NOT contain hardcoded bridge words list
    assert "'haan haan', 'achha okay okay', 'ohh', 'actually', 'matlab', 'bilkul', 'sahi', 'fair point', 'exactly', 'dekhiye'" not in prompt_default
    assert "Colloquial Hinglish Cadence" in prompt_default
    assert "Bilkul samjha sir, thank you for your time. Have a great day!" in prompt_default

    # Test 2: Immediate disconnect setting (harmonious instruction)
    engine_imm = ConversationEngine(
        objective="Collect feedback",
        lead_context={"business_name": "Beta Labs", "agent_name": "Sage"},
        voice_config={
            "settings": {
                "callCutRule": "immediate_disconnect",
                "disconnectPhrase": "Thank you, goodbye."
            }
        }
    )
    prompt_imm = engine_imm.system_prompt
    assert "Immediate Disconnect" in prompt_imm
    assert "Thank you, goodbye." in prompt_imm
    # Must NOT command "Never just disconnect" when immediate_disconnect is chosen
    assert "Never just disconnect" not in prompt_imm
    assert "Respect their decision immediately" in prompt_imm

    print("[PASS] ConversationEngine prompt verified: no hardcoded bridge words, dynamic call-cut rules active.")


async def test_sage_capsule_grounding_and_dialer():
    print("Testing Sage Knowledge Capsule Grounding & Direct Dialer Actions...")
    agent_state = {
        "name": "SaaS Closer",
        "role": "outbound_qualification",
        "capsule_name": "CloudERP Pro for Manufacturing",
        "capsule_context": "CloudERP Pro eliminates factory inventory tracking errors and reduces lead time by 35%.",
        "capsule_metadata": {
            "description": "Enterprise Resource Planning for mid-market factories",
            "target_audience": "Factory Owners and Plant Heads in India",
            "value_props": "Real-time scrap tracking and automated GST invoice reconciliation"
        },
        "settings": {
            "callCutRule": "reframe_once_then_exit"
        }
    }

    # Verify context summary builder extracts capsule metadata
    summary = _build_context_summary(agent_state)
    assert "CloudERP Pro for Manufacturing" in summary
    assert "Factory Owners and Plant Heads" in summary
    assert "Real-time scrap tracking" in summary

    # Verify cold call action card option presence
    res_dial = await run_sage_conversation(
        messages=[],
        query="Place one cold call to my number right now",
        agent_state=agent_state
    )
    assert res_dial["action_card"] is not None
    assert "Place one cold call to my number right now" in res_dial["action_card"]["options"]

    print("[PASS] Knowledge Capsule Grounding & Direct Dialer verified cleanly.")


async def test_sage_deep_capsule_fields():
    print("Testing Sage Deep Capsule Model Fields (Specs, Differentiators, Pain Points)...")
    agent_state = {
        "name": "Factory Automation Agent",
        "capsule_name": "RoboWeld AI",
        "capsule_metadata": {
            "product_name": "RoboWeld Pro-X",
            "product_specification": "Automated MIG/TIG robotic arm controller with 0.1mm repeatability",
            "target_audience": "Automotive Tier 1 suppliers in Pune & Chennai",
            "value_props": "Cuts weld cycle time by 45% and eliminates human defect rate",
            "pain_points_solved": "Skilled welder labor shortages and costly structural defect rework",
            "company_name": "RoboWeld Technologies"
        }
    }
    summary = _build_context_summary(agent_state)
    assert "RoboWeld Pro-X" in summary
    assert "Automated MIG/TIG robotic arm" in summary
    assert "Automotive Tier 1 suppliers" in summary
    assert "Cuts weld cycle time by 45%" in summary
    assert "Skilled welder labor shortages" in summary
    assert "RoboWeld Technologies" in summary

    print("[PASS] Deep Knowledge Capsule fields extracted and verified.")


async def test_outbound_dialer_api_logic():
    print("Testing Outbound Dialer Phone Normalization & Telephony Logic...")
    from utils.telephony import normalize_indian_phone_number

    # 1. Phone normalization
    assert normalize_indian_phone_number("9876543210") == "+919876543210"
    assert normalize_indian_phone_number("+919876543210") == "+919876543210"
    assert normalize_indian_phone_number("09876543210") == "+919876543210"
    assert normalize_indian_phone_number("919876543210") == "+919876543210"

    # 2. Invalid numbers raise ValueError
    try:
        normalize_indian_phone_number("12345")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass

    print("[PASS] Outbound dialer phone normalization verified.")


async def test_sage_empowered_categories():
    print("Testing Sage Empowered Inbound Support, Knowledge Base, Cold Calling & Production Readiness...")
    agent_state = {
        "name": "Omni Agent",
        "role": "outbound_qualification",
        "settings": {"callCutRule": "reframe_once_then_exit"}
    }

    # 1. Inbound support setup
    res_inbound = await run_sage_conversation(
        messages=[],
        query="Set up an agent for inbound support calls",
        agent_state=agent_state
    )
    assert res_inbound["patch"].get("role") == "inbound_support"
    assert res_inbound["patch"].get("greeting_enabled") is True
    assert "support" in res_inbound["patch"].get("greeting_text", "").lower()
    assert "inbound" in res_inbound["body"].lower()

    # 2. Knowledge base grounding with mock DB
    class MockCapsule:
        id = 42
        name = "Product Catalog Capsule"
        product_name = "Catalog Pro"
        product_specification = "Specs"
        target_audience = "B2B"
        key_differentiators = "Diffs"
        pain_points_solved = "Pains"
        additional_context = "Context"

    class MockQuery:
        def filter(self, *criteria):
            return self

        def first(self):
            return MockCapsule()

    class MockDB:
        def query(self, model):
            return MockQuery()

    res_kb = await run_sage_conversation(
        messages=[],
        query="Add a knowledge base for product questions",
        agent_state=agent_state,
        user_id=1,
        db=MockDB()
    )
    assert "knowledge" in res_kb["body"].lower() or "ground" in res_kb["body"].lower()
    assert "KNOWLEDGE CAPSULE GROUNDING" in res_kb["patch"].get("fine_tuning_directives", "")
    assert res_kb["patch"].get("capsule_id") == 42, "Knowledge base card must attach capsule_id"

    # 3. Outbound cold calling with graceful call-cut rules
    res_cold = await run_sage_conversation(
        messages=[],
        query="Configure outbound cold calling with graceful call-cut rules",
        agent_state=agent_state
    )
    assert res_cold["patch"].get("greeting_enabled") is False, "Outbound cold calling card must disable fixed greeting"
    assert res_cold["patch"]["settings"].get("callCutRule") == "reframe_once_then_exit"

    # 4. Indian English & Hinglish cadence
    res_tone = await run_sage_conversation(
        messages=[],
        query="Calibrate authentic Indian English & Hinglish cadence",
        agent_state=agent_state
    )
    assert res_tone["patch"]["voice_config"].get("speaker") == "shubh_enhi_ads"
    assert "AUTHENTIC HUMAN CADENCE" in res_tone["patch"].get("fine_tuning_directives", "")

    # 5. Live call readiness
    res_ready = await run_sage_conversation(
        messages=[],
        query="Get an agent ready to take live calls",
        agent_state=agent_state
    )
    assert "live" in res_ready["body"].lower() or "production" in res_ready["body"].lower()
    assert res_ready["patch"]["settings"].get("bargeIn") is True
    assert res_ready["patch"]["settings"].get("maxCallLength") == 15
    assert res_ready["patch"]["settings"].get("backgroundSound") == "office"

    print("[PASS] All 5 Empowered Starter Cards & Database Grounding verified cleanly.")


async def main():
    await test_sage_heuristic_rejection_and_call_cut()
    await test_sage_multi_strategy_objection_and_call_cut()
    await test_sage_cold_call_and_tone()
    test_conversation_engine_dynamic_prompt()
    await test_sage_capsule_grounding_and_dialer()
    await test_sage_deep_capsule_fields()
    await test_outbound_dialer_api_logic()
    await test_sage_empowered_categories()
    print("\nALL SAGE AI AGENT ARCHITECT TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(main())


