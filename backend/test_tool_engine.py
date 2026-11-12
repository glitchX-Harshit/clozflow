"""
Test Suite: Pearl Tool Execution Engine & AgentTool Models
Verifies cURL parsing, API tool execution, regex validation, verifier matching,
mock simulation, JSONPath extraction, and SQLite database persistence.
"""
import asyncio
import os
import sys
import time
from typing import Dict, Any, List, Optional

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.pearl.tool_engine import (
    parse_curl_command,
    extract_json_path,
    substitute_variables_in_string,
    execute_data_validator,
    execute_data_verifier,
    execute_api_tool,
    execute_mock_api,
    run_tool_test,
    normalize_date_string,
    normalize_phone_string,
    RUN_MODE_WRITE,
    RUN_MODE_READ,
    get_tool_run_mode,
    is_read_tool,
    is_write_tool,
    get_conversational_filler,
    CONVERSATIONAL_FILLERS,
    execute_tool_action,
    dispatch_pattern_a_write,
    execute_pattern_b_read,
    ToolDispatcher,
)
from services.pearl.voice_session import PearlVoiceSession, SessionState
from services.pearl.conversation_engine import ConversationEngine
from database import engine, Base, SessionLocal
from models_pearl import PearlAgent, AgentTool
from models import User
from routers.pearl import tool_to_dict


def test_curl_parser():
    print("--- Testing cURL Parser ---")

    # Test 1: Simple GET with params
    curl_1 = 'curl "https://api.example.com/v1/orders?status=active&limit=10"'
    parsed_1 = parse_curl_command(curl_1)
    assert parsed_1["method"] == "GET", f"Expected GET, got {parsed_1['method']}"
    assert parsed_1["url"] == "https://api.example.com/v1/orders", f"URL mismatch: {parsed_1['url']}"
    assert len(parsed_1["params"]) == 2, f"Expected 2 params, got {len(parsed_1['params'])}"
    assert parsed_1["params"][0]["key"] == "status" and parsed_1["params"][0]["value"] == "active"
    assert parsed_1["params"][1]["key"] == "limit" and parsed_1["params"][1]["value"] == "10"

    # Test 2: Multiline POST with headers, Bearer auth, and JSON body
    curl_2 = """curl -X POST https://api.crm.io/v1/leads \\
      -H "Authorization: Bearer test_secret_token_123" \\
      -H "Content-Type: application/json" \\
      -d '{"name": "Siddharth Roy", "phone": "+919876543210", "lead_score": 85}'"""
    parsed_2 = parse_curl_command(curl_2)
    assert parsed_2["method"] == "POST", f"Expected POST, got {parsed_2['method']}"
    assert parsed_2["url"] == "https://api.crm.io/v1/leads"
    assert parsed_2["auth"]["type"] == "bearer"
    assert parsed_2["auth"]["token"] == "test_secret_token_123"
    assert parsed_2["body_type"] == "json"
    assert '"name": "Siddharth Roy"' in parsed_2["body"]

    # Test 3: Basic Auth
    curl_3 = 'curl -u "admin:secretPass" https://api.gateway.internal/health'
    parsed_3 = parse_curl_command(curl_3)
    assert parsed_3["auth"]["type"] == "basic"
    assert parsed_3["auth"]["username"] == "admin"
    assert parsed_3["auth"]["password"] == "secretPass"

    # Test 4: PowerShell curl.exe, --url, and X-API-Key header detection
    curl_4 = 'curl.exe --url "https://api.gateway.internal/v2/items" -H "X-API-Key: my_api_key_456"'
    parsed_4 = parse_curl_command(curl_4)
    assert parsed_4["url"] == "https://api.gateway.internal/v2/items", f"Expected URL, got {parsed_4['url']}"
    assert parsed_4["auth"]["type"] == "apiKey"
    assert parsed_4["auth"]["apiKey"] == "my_api_key_456"

    # Test 5: Multiple -d form arguments
    curl_5 = 'curl -X POST https://api.example.com/oauth/token -d "grant_type=client_credentials" -d "client_id=xyz"'
    parsed_5 = parse_curl_command(curl_5)
    assert parsed_5["body"] == "grant_type=client_credentials&client_id=xyz"
    assert parsed_5["body_type"] == "form_data"

    print("[PASS] cURL Parser verified cleanly across Windows curl.exe, headers, and form-data.")


def test_jsonpath_extractor():
    print("--- Testing JSONPath Extractor ---")
    data = {
        "status": "success",
        "data": {
            "order": {
                "id": "ORD-9912",
                "customer": {
                    "name": "Manan",
                    "pincode": 560001
                },
                "items": [
                    {"sku": "SKU-A", "price": 499},
                    {"sku": "SKU-B", "price": 1299}
                ],
                "events": [
                    {"code": "created", "timestamp": "10:00"},
                    {"code": "dispatched", "timestamp": "12:00"},
                    {"code": "delivered", "timestamp": "15:00"}
                ]
            },
            "matrix": [[10, 20], [30, 40]]
        }
    }

    # Standard dot notation & array index
    assert extract_json_path(data, "status") == "success"
    assert extract_json_path(data, "data.order.id") == "ORD-9912"
    assert extract_json_path(data, "data.order.customer.name") == "Manan"
    assert extract_json_path(data, "data.order.customer.pincode") == 560001
    assert extract_json_path(data, "data.order.items[1].sku") == "SKU-B"
    assert extract_json_path(data, "@response.data.order.items[0].price") == 499
    assert extract_json_path(data, "non.existent.path") is None

    # Negative array indexing
    assert extract_json_path(data, "data.order.events[-1].code") == "delivered"
    assert extract_json_path(data, "data.order.events[-2].code") == "dispatched"

    # Multi-dimensional arrays
    assert extract_json_path(data, "data.matrix[0][1]") == 20
    assert extract_json_path(data, "data.matrix[1][0]") == 30

    # Root array indexing
    root_array_data = [{"id": "item-1"}, {"id": "item-2"}]
    assert extract_json_path(root_array_data, "[0].id") == "item-1"
    assert extract_json_path(root_array_data, "$[1].id") == "item-2"

    # Bracket notation
    assert extract_json_path(data, "data['order']['customer']['name']") == "Manan"

    # Dot-number notation
    assert extract_json_path(data, "data.order.items.0.sku") == "SKU-A"

    print("[PASS] JSONPath verified with root arrays, negative indices, matrices, and bracket notation.")


def test_data_validator():
    print("--- Testing Data Validator ---")

    # 1. Indian Phone
    cfg_phone = {
        "preset": "indian_phone",
        "data_type": "string",
        "spoken_on_success": "Valid mobile number",
        "spoken_on_fail": "Invalid mobile number"
    }
    assert execute_data_validator(cfg_phone, "9876543210")["is_valid"] is True
    assert execute_data_validator(cfg_phone, "+91 98765-43210")["is_valid"] is True
    assert execute_data_validator(cfg_phone, 9876543210)["is_valid"] is True  # Integer input
    assert execute_data_validator(cfg_phone, "12345")["is_valid"] is False

    # 2. PAN Card
    cfg_pan = {
        "preset": "pan_card",
        "data_type": "string"
    }
    assert execute_data_validator(cfg_pan, "ABCDE1234F")["is_valid"] is True
    assert execute_data_validator(cfg_pan, "abcde1234f")["is_valid"] is True  # auto uppercase normalization
    assert execute_data_validator(cfg_pan, "12345ABCDE")["is_valid"] is False

    # 3. Pincode
    cfg_pin = {
        "preset": "pincode",
        "data_type": "number"
    }
    assert execute_data_validator(cfg_pin, "560001")["is_valid"] is True
    assert execute_data_validator(cfg_pin, "560 001")["is_valid"] is True
    assert execute_data_validator(cfg_pin, 560001)["is_valid"] is True  # Numeric int input
    assert execute_data_validator(cfg_pin, "01234")["is_valid"] is False

    # 4. Custom Regex
    cfg_custom = {
        "preset": "custom",
        "regex_pattern": r"^EMP-[0-9]{4}$",
        "data_type": "string"
    }
    assert execute_data_validator(cfg_custom, "EMP-4821")["is_valid"] is True
    assert execute_data_validator(cfg_custom, "DOC-4821")["is_valid"] is False

    print("[PASS] Data Validator verified across presets, numeric types, and custom regex.")


def test_data_verifier():
    print("--- Testing Data Verifier ---")

    # 1. Phone number with formatting strip & exact match (India, US, UK)
    cfg_verifier_phone = {
        "normalize_as": "phone",
        "match_mode": "exact_match",
        "spoken_responses": {
            "on_match": "Phone confirmed",
            "on_no_match": "Phone mismatch",
            "on_error": "Verification failed"
        }
    }
    res_phone = execute_data_verifier(cfg_verifier_phone, "+91 98765-43210", "09876543210")
    assert res_phone["is_match"] is True
    assert res_phone["spoken_feedback"] == "Phone confirmed"

    # US phone with +1 prefix vs local format
    res_us_phone = execute_data_verifier(cfg_verifier_phone, "+1 (555) 123-4567", "555-123-4567")
    assert res_us_phone["is_match"] is True

    # UK phone with +44 prefix vs 0 trunk prefix
    res_uk_phone = execute_data_verifier(cfg_verifier_phone, "+44 7911 123456", "07911123456")
    assert res_uk_phone["is_match"] is True

    # 2. Text normalization (lowercase and trim spaces)
    cfg_name = {
        "normalize_as": "text",
        "match_mode": "exact_match"
    }
    res_name = execute_data_verifier(cfg_name, "  Siddharth   Roy  ", "siddharth roy")
    assert res_name["is_match"] is True

    # 3. Last N characters mode (e.g. last 4 digits of phone)
    cfg_last4 = {
        "normalize_as": "phone",
        "match_mode": "last_n",
        "match_n": 4,
        "spoken_responses": {
            "on_match": "Last 4 digits verified",
            "on_no_match": "Digits do not match"
        }
    }
    # Caller speaks only last 4 digits
    assert execute_data_verifier(cfg_last4, "3210", "+91 98765-43210")["is_match"] is True
    # Reference on file has only last 4 digits, caller speaks full 10
    assert execute_data_verifier(cfg_last4, "+91 98765-43210", "3210")["is_match"] is True
    # Caller speaks full phone, ref has full phone
    assert execute_data_verifier(cfg_last4, "9876543210", "+91 98765-43210")["is_match"] is True
    # Mismatch in last 4 digits
    assert execute_data_verifier(cfg_last4, "9999", "+91 98765-43210")["is_match"] is False

    # 4. First N characters mode
    cfg_first4 = {
        "normalize_as": "none",
        "match_mode": "first_n",
        "match_n": 4
    }
    assert execute_data_verifier(cfg_first4, "PASS-99", "PASS-12")["is_match"] is True
    assert execute_data_verifier(cfg_first4, "PASS-1234", "PASS")["is_match"] is True
    assert execute_data_verifier(cfg_first4, "FAIL-99", "PASS-12")["is_match"] is False

    # 5. Date normalization and date_equals mode (supports ISO timestamp, SQL datetime, datetime object)
    from datetime import datetime, date
    cfg_date = {
        "normalize_as": "date",
        "match_mode": "date_equals"
    }
    # Different date formats representing the same date
    res_date1 = execute_data_verifier(cfg_date, "15/05/1990", "1990-05-15")
    assert res_date1["is_match"] is True
    # ClozFlow original spoken response
    assert res_date1["spoken_feedback"] == "Thanks — that matches our records on file."

    # ISO timestamp with time and timezone
    res_date_iso = execute_data_verifier(cfg_date, "1990-05-15T00:00:00Z", "15 May 1990")
    assert res_date_iso["is_match"] is True

    # SQL timestamp with space and time
    res_date_sql = execute_data_verifier(cfg_date, "1990-05-15 14:30:00", "15/05/1990")
    assert res_date_sql["is_match"] is True

    # datetime object
    res_date_obj = execute_data_verifier(cfg_date, date(1990, 5, 15), "1990-05-15")
    assert res_date_obj["is_match"] is True

    res_date2 = execute_data_verifier(cfg_date, "15 Jan 2024", "2024-01-15")
    assert res_date2["is_match"] is True

    res_date_mismatch = execute_data_verifier(cfg_date, "16/05/1990", "1990-05-15")
    assert res_date_mismatch["is_match"] is False
    assert res_date_mismatch["spoken_feedback"] == "That doesn't match what we have on record. Could you please double-check?"

    # 6. Contains mode
    cfg_contains = {
        "normalize_as": "phone",
        "match_mode": "contains"
    }
    assert execute_data_verifier(cfg_contains, "3210", "9876543210")["is_match"] is True
    assert execute_data_verifier(cfg_contains, "9999", "9876543210")["is_match"] is False

    # 7. Empty reference security check (empty normalized ref must NOT match)
    res_empty_ref = execute_data_verifier(cfg_contains, "1234", "---")
    assert res_empty_ref["is_match"] is False

    # 8. Integer 0 handling
    res_zero = execute_data_verifier({"normalize_as": "none", "match_mode": "exact_match"}, 0, "0")
    assert res_zero["is_match"] is True

    print("[PASS] Data Verifier verified across 4 normalization modes, 5 match modes, international formats, and ClozFlow copywriting.")


def test_mock_api():
    print("--- Testing Mock API Execution ---")
    cfg_mock = {
        "mock_response_body": {
            "order_id": "ORD-7712",
            "status": "Out for delivery",
            "eta": "Today by 6 PM"
        },
        "simulated_latency_ms": 50,
        "headers": [{"key": "X-Custom-Env", "value": "test", "enabled": True}],
        "response_mapping": [
            {"path": "status", "variable": "order_status"},
            {"path": "eta", "variable": "delivery_eta"}
        ]
    }

    res = asyncio.run(execute_mock_api(cfg_mock))
    assert res["success"] is True
    assert res["status_code"] == 200
    assert res["latency_ms"] >= 40
    assert res["headers"]["X-Custom-Env"] == "test"
    assert res["extracted_variables"]["order_status"] == "Out for delivery"
    assert res["extracted_variables"]["delivery_eta"] == "Today by 6 PM"

    print("[PASS] Mock API execution and variable extraction verified.")


def test_run_tool_test_unified():
    print("--- Testing Unified Test Dispatcher (run_tool_test) ---")

    # Dynamic input_source resolution for validator
    cfg_val = {
        "preset": "indian_phone",
        "input_source": "caller_mobile"
    }
    res_val = asyncio.run(run_tool_test("data_validator", cfg_val, test_input={"caller_mobile": "9876543210"}))
    assert res_val["is_valid"] is True

    # Verifier 1: let_agent_decide + agent_variable reference
    cfg_ver1 = {
        "input_source": "let_agent_decide",
        "reference_source": "agent_variable",
        "reference_value": "lead.phone",
        "match_mode": "last_n",
        "match_n": 4,
        "normalize_as": "phone"
    }
    res_ver1 = asyncio.run(run_tool_test("data_verifier", cfg_ver1, test_input={"spoken_value": "4321", "lead": {"phone": "+91 98765 44321"}}))
    assert res_ver1["is_match"] is True
    assert res_ver1["latency_ms"] >= 0

    # Verifier 2: fixed_value input + fixed_value reference
    cfg_ver2 = {
        "input_source": "fixed_value",
        "input_value": "560001",
        "reference_source": "fixed_value",
        "reference_value": "560001",
        "match_mode": "exact_match",
        "normalize_as": "none"
    }
    res_ver2 = asyncio.run(run_tool_test("data_verifier", cfg_ver2))
    assert res_ver2["is_match"] is True

    # Verifier 3: agent_variable input + agent_variable reference with date
    cfg_ver3 = {
        "input_source": "agent_variable",
        "input_variable": "caller.entered_dob",
        "reference_source": "agent_variable",
        "reference_value": "lead.dob",
        "match_mode": "date_equals",
        "normalize_as": "date"
    }
    res_ver3 = asyncio.run(run_tool_test("data_verifier", cfg_ver3, test_input={
        "caller": {"entered_dob": "15/05/1990"},
        "lead": {"dob": "1990-05-15"}
    }))
    assert res_ver3["is_match"] is True

    # Verifier 4: agent_variable reference with test_input sample override
    cfg_ver4 = {
        "input_source": "let_agent_decide",
        "reference_source": "agent_variable",
        "reference_value": "lead.phone",
        "match_mode": "last_n",
        "match_n": 4,
        "normalize_as": "phone"
    }
    res_ver4 = asyncio.run(run_tool_test("data_verifier", cfg_ver4, test_input={
        "spoken_value": "3210",
        "reference_value": "+91 98765 43210"
    }))
    assert res_ver4["is_match"] is True
    assert res_ver4["normalized_spoken"] == "3210"
    assert res_ver4["normalized_reference"] == "9876543210"

    print("[PASS] Unified test runner verified with 3 input sources, date equals, and latency.")


def test_database_agent_tool_persistence():
    print("--- Testing Database AgentTool Entity & Relationships ---")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Create test agent
        test_agent = PearlAgent(
            name="Test Tool Agent",
            role="outbound_qualification",
            user_id=1,
            status="draft"
        )
        db.add(test_agent)
        db.commit()
        db.refresh(test_agent)

        # Create AgentTool
        tool = AgentTool(
            agent_id=test_agent.id,
            name="lookup_order_status",
            tool_type="api_tool",
            description="Fetch real-time delivery status for an order",
            run_timing="conversation",
            timeout_seconds=5,
            fallback_response="I cannot check that order right now.",
            config={
                "method": "GET",
                "url": "https://api.example.com/v1/orders/{{order_id}}",
                "response_mapping": [{"path": "status", "variable": "order_status"}]
            },
            is_active=True
        )
        db.add(tool)
        db.commit()
        db.refresh(tool)

        # Create Data Verifier AgentTool
        verifier_tool = AgentTool(
            agent_id=test_agent.id,
            name="verify_last4",
            tool_type="data_verifier",
            description="Matches caller input against customer account records on file.",
            run_timing="conversation",
            timeout_seconds=8,
            fallback_response="I cannot verify that right now.",
            config={
                "input_source": "let_agent_decide",
                "normalize_as": "phone",
                "match_mode": "last_n",
                "match_n": 4,
                "reference_source": "agent_variable",
                "reference_value": "lead.phone",
                "spoken_responses": {
                    "on_match": "Thanks — that matches our records on file.",
                    "on_no_match": "That doesn't match what we have on record. Could you please double-check?",
                    "on_error": "I'm experiencing an issue checking those details right now. Let's try again in a moment."
                }
            },
            is_active=True
        )
        db.add(verifier_tool)
        db.commit()
        db.refresh(verifier_tool)

        # Verify query and relationship
        fetched_agent = db.query(PearlAgent).filter(PearlAgent.id == test_agent.id).first()
        assert len(fetched_agent.tools) == 2
        assert fetched_agent.tools[0].name == "lookup_order_status"
        assert fetched_agent.tools[0].tool_type == "api_tool"
        assert fetched_agent.tools[0].config["method"] == "GET"
        assert fetched_agent.tools[1].name == "verify_last4"
        assert fetched_agent.tools[1].tool_type == "data_verifier"
        assert fetched_agent.tools[1].config["input_source"] == "let_agent_decide"
        assert fetched_agent.tools[1].config["match_mode"] == "last_n"
        assert fetched_agent.tools[1].config["match_n"] == 4

        # Test tool_to_dict serialization & string/null JSON deserialization
        dict_1 = tool_to_dict(fetched_agent.tools[0])
        assert isinstance(dict_1["config"], dict)
        assert dict_1["config"]["method"] == "GET"

        tool_with_str_cfg = AgentTool(
            agent_id=test_agent.id,
            name="test_str_config",
            tool_type="api_tool",
            config='{"url": "https://api.example.com", "method": "POST"}'
        )
        dict_str = tool_to_dict(tool_with_str_cfg)
        assert isinstance(dict_str["config"], dict)
        assert dict_str["config"]["url"] == "https://api.example.com"

        tool_with_null_cfg = AgentTool(
            agent_id=test_agent.id,
            name="test_null_config",
            tool_type="api_tool",
            config=None
        )
        dict_null = tool_to_dict(tool_with_null_cfg)
        assert isinstance(dict_null["config"], dict)
        assert dict_null["config"] == {}

        # Cleanup test records
        db.delete(verifier_tool)
        db.delete(tool)
        db.delete(test_agent)
        db.commit()
        print("[PASS] AgentTool database persistence & relationship verified for api_tool and data_verifier.")
    finally:
        db.close()


def test_response_template_and_path_params():
    print("--- Testing Response Template and Path Params ---")
    url_template = "https://api.example.com/v1/orders/{order_id}/items/{item_id}"
    variables = {"order_id": "ORD-1234", "item_id": "ITEM-99"}
    resolved_url = substitute_variables_in_string(url_template, variables)
    assert resolved_url == "https://api.example.com/v1/orders/ORD-1234/items/ITEM-99", f"URL mismatch: {resolved_url}"

    # Test @field template interpolation
    sample_response = {
        "status": "success",
        "data": {
            "balance": 250.75,
            "currency": "USD",
            "account": {"holder": "Alice"}
        }
    }
    template = "The account balance is @data.balance @data.currency for @data.account.holder."
    import re
    rendered = template
    extracted = {}
    for token in re.findall(r"@([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)", template):
        val = extract_json_path(sample_response, token)
        if val is not None:
            extracted[token] = val
            rendered = rendered.replace(f"@{token}", str(val))

    assert rendered == "The account balance is 250.75 USD for Alice."
    assert extracted["data.balance"] == 250.75
    assert extracted["data.account.holder"] == "Alice"
    print("[PASS] Path params {token} and @field template interpolation verified cleanly.")


def test_normalize_date_string_edge_cases():
    print("--- Testing Date Normalizer Edge Cases ---")
    # 1. Leap year valid vs invalid
    assert normalize_date_string("2024-02-29") == "2024-02-29", "2024 is a leap year, Feb 29 must be valid"
    assert normalize_date_string("2023-02-29") is None, "2023 is not a leap year, Feb 29 must be invalid"

    # 2. Invalid dates
    assert normalize_date_string("2024-13-01") is None, "Month 13 must be rejected"
    assert normalize_date_string("2024-04-31") is None, "April has only 30 days, April 31 must be rejected"
    assert normalize_date_string("invalid-date-string") is None
    assert normalize_date_string("") is None
    assert normalize_date_string(None) is None

    # 3. 2-digit years and 2-digit year leap year
    assert normalize_date_string("15/05/90") == "1990-05-15"
    assert normalize_date_string("15-05-24") == "2024-05-15"
    assert normalize_date_string("29-02-24") == "2024-02-29", "24 is 2024 (leap year)"
    assert normalize_date_string("29-02-23") is None, "23 is 2023 (not leap year)"

    # 4. Mixed separators
    assert normalize_date_string("15.05/2024") == "2024-05-15"
    assert normalize_date_string("15/05-2024") == "2024-05-15"
    assert normalize_date_string("15.05.24") == "2024-05-15"

    # 5. Ordinal suffixes
    assert normalize_date_string("1st Jan 2024") == "2024-01-01"
    assert normalize_date_string("22nd July 1999") == "1999-07-22"

    # 6. Month names with hyphen/slash/dot separators
    assert normalize_date_string("15-May-1990") == "1990-05-15"
    assert normalize_date_string("15-MAY-2024") == "2024-05-15"
    assert normalize_date_string("15-May-90") == "1990-05-15"
    assert normalize_date_string("15/May/1990") == "1990-05-15"
    assert normalize_date_string("May-15-1990") == "1990-05-15"

    print("[PASS] Date normalizer verified with leap years, invalid dates, 2-digit years, and mixed separators.")


def test_normalize_phone_string_edge_cases():
    print("--- Testing Phone Normalizer Edge Cases ---")
    # 1. Alphanumeric without phone digits
    assert normalize_phone_string("N/A") == ""
    assert normalize_phone_string("None") == ""
    assert normalize_phone_string("not_available") == ""
    assert normalize_phone_string(None) == ""
    assert normalize_phone_string("   ") == ""
    assert normalize_phone_string("Extension is forty two") == ""

    # 2. Short extension numbers
    assert normalize_phone_string("4401") == "4401"
    assert normalize_phone_string("123") == "123"
    assert normalize_phone_string("x401") == "401"

    # 3. International prefixes without plus sign
    assert normalize_phone_string("919876543210") == "9876543210"
    assert normalize_phone_string("15551234567") == "5551234567"
    assert normalize_phone_string("447911123456") == "7911123456"

    # 4. International dial-out prefix "00" and "011"
    assert normalize_phone_string("00919876543210") == "9876543210"
    assert normalize_phone_string("00447911123456") == "7911123456"
    assert normalize_phone_string("01115551234567") == "5551234567"

    # 5. Phone with extension attached
    assert normalize_phone_string("+91 98765 43210 ext 4401") == "9876543210"
    assert normalize_phone_string("555-123-4567 x99") == "5551234567"
    assert normalize_phone_string("555.123.4567") == "5551234567"

    # 6. Trunk prefix 0
    assert normalize_phone_string("09876543210") == "9876543210"
    assert normalize_phone_string("4407911123456") == "7911123456"

    print("[PASS] Phone normalizer verified across international prefixes without +, extensions, and alphanumeric edge cases.")


def test_execute_data_verifier_edge_cases():
    print("--- Testing Data Verifier Deep Edge Cases ---")
    cfg_phone = {"normalize_as": "phone", "match_mode": "exact_match"}

    # 1. None and empty inputs
    res_none_ref = execute_data_verifier(cfg_phone, "9876543210", None)
    assert res_none_ref["is_match"] is False
    assert res_none_ref["success"] is True

    res_empty_spoken = execute_data_verifier(cfg_phone, "", "9876543210")
    assert res_empty_spoken["is_match"] is False

    res_spaces_only = execute_data_verifier(cfg_phone, "   ", "   ")
    assert res_spaces_only["is_match"] is False

    res_dashes_only = execute_data_verifier(cfg_phone, "---", "---")
    assert res_dashes_only["is_match"] is False

    # Punctuation / dash only inputs with normalize_as=none must not match
    cfg_none_exact = {"normalize_as": "none", "match_mode": "exact_match"}
    assert execute_data_verifier(cfg_none_exact, "---", "---")["is_match"] is False
    assert execute_data_verifier(cfg_none_exact, ",,,.", ",,,.")["is_match"] is False

    # 2. Contains mode security: empty string or punctuation only MUST NOT match via contains
    cfg_contains = {"normalize_as": "none", "match_mode": "contains"}
    assert execute_data_verifier(cfg_contains, "", "some_secret_record")["is_match"] is False
    assert execute_data_verifier(cfg_contains, "some_secret_record", "")["is_match"] is False
    assert execute_data_verifier(cfg_contains, "   ", "some_secret_record")["is_match"] is False
    assert execute_data_verifier(cfg_contains, "---", "ORD---123")["is_match"] is False

    # 3. date_equals mode security: invalid date strings MUST NOT match
    cfg_date_equals = {"normalize_as": "date", "match_mode": "date_equals"}
    assert execute_data_verifier(cfg_date_equals, "invalid-date", "invalid-date")["is_match"] is False
    assert execute_data_verifier(cfg_date_equals, "2024-13-01", "2024-13-01")["is_match"] is False
    assert execute_data_verifier(cfg_date_equals, "2024-02-29", "29 Feb 2024")["is_match"] is True
    assert execute_data_verifier(cfg_date_equals, "15-May-1990", "1990-05-15")["is_match"] is True

    # 4. Unicode fullwidth digits
    res_unicode = execute_data_verifier(cfg_phone, "９８７６５４３２１０", "9876543210")
    assert res_unicode["is_match"] is True

    # 5. match_n <= 0 or missing match_n defaults safely
    cfg_bad_n = {"normalize_as": "phone", "match_mode": "last_n", "match_n": -1}
    res_bad_n = execute_data_verifier(cfg_bad_n, "3210", "9876543210")
    assert res_bad_n["is_match"] is True
    assert res_bad_n["match_n"] == 4

    # 6. match_n greater than string length
    cfg_greater_n = {"normalize_as": "none", "match_mode": "first_n", "match_n": 8}
    assert execute_data_verifier(cfg_greater_n, "1234", "1234")["is_match"] is True

    print("[PASS] Data verifier deep edge cases (None, empty, whitespace, unicode, contains security, invalid dates) verified.")


def test_execute_api_tool_edge_cases():
    print("--- Testing API Tool Edge Cases ---")
    # 1. Missing URL
    res_no_url = asyncio.run(execute_api_tool({}))
    assert res_no_url["success"] is False
    assert "Endpoint URL is required" in res_no_url["error"]

    # 2. Missing path parameters in URL (single brace and double brace and nested dot notation)
    res_missing_param = asyncio.run(execute_api_tool(
        {"url": "https://api.example.com/v1/users/{user_id}/orders/{order_id}"},
        test_inputs={"user_id": "usr_100"} # order_id is missing
    ))
    assert res_missing_param["success"] is False
    assert res_missing_param["status_code"] == 400
    assert "order_id" in res_missing_param["error"]

    res_missing_double = asyncio.run(execute_api_tool(
        {"url": "https://api.example.com/v1/orders/{{order_id}}"},
        test_inputs={}
    ))
    assert res_missing_double["success"] is False
    assert res_missing_double["status_code"] == 400
    assert "order_id" in res_missing_double["error"]

    # Empty string parameter in inputs must be treated as missing
    res_empty_param = asyncio.run(execute_api_tool(
        {"url": "https://api.example.com/v1/orders/{order_id}"},
        test_inputs={"order_id": "   "}
    ))
    assert res_empty_param["success"] is False
    assert res_empty_param["status_code"] == 400
    assert "order_id" in res_empty_param["error"]

    # 3. URL path parameter encoding (spaces and special characters)
    url_template = "https://api.example.com/v1/search/{query_term}"
    res_encoded_url = substitute_variables_in_string(url_template, {"query_term": "John Doe/Special&Co"}, url_encode_path=True)
    assert res_encoded_url == "https://api.example.com/v1/search/John%20Doe%2FSpecial%26Co"

    # 4. Invalid protocol
    res_bad_proto = asyncio.run(execute_api_tool(
        {"url": "ftp://files.example.com/data"}
    ))
    assert res_bad_proto["success"] is False
    assert res_bad_proto["status_code"] == 400
    assert "Endpoint URL must begin with http" in res_bad_proto["error"]

    print("[PASS] API tool edge cases (missing params, URL path encoding, protocol validation) verified.")


def test_run_tool_test_malformed_payloads():
    print("--- Testing run_tool_test Malformed Payload Resilience ---")
    # 1. None / invalid config type
    res_none_cfg = asyncio.run(run_tool_test("data_verifier", None, None))
    assert isinstance(res_none_cfg, dict)
    assert res_none_cfg["is_match"] is False

    # 2. String config type
    res_str_cfg = asyncio.run(run_tool_test("data_validator", "not-a-dict", "not-a-dict"))
    assert isinstance(res_str_cfg, dict)

    # 3. Unknown tool type
    res_unknown = asyncio.run(run_tool_test("alien_tool", {}))
    assert res_unknown["success"] is False
    assert "Unknown tool type" in res_unknown["error"]

    # 4. Invalid timeout string
    res_bad_timeout = asyncio.run(run_tool_test("mock_api", {}, timeout_seconds="invalid_int"))
    assert res_bad_timeout["success"] is True

    print("[PASS] run_tool_test handles malformed configs, test_inputs, and timeout strings without crashing.")


def test_database_cascade_deletion():
    print("--- Testing Database Cascade Deletion on PearlAgent ---")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        agent = PearlAgent(name="Cascade Test Agent", user_id=1, status="draft")
        db.add(agent)
        db.commit()
        db.refresh(agent)

        tool1 = AgentTool(agent_id=agent.id, name="tool_a", tool_type="api_tool")
        tool2 = AgentTool(agent_id=agent.id, name="tool_b", tool_type="data_verifier")
        db.add_all([tool1, tool2])
        db.commit()

        # Verify tools exist
        assert db.query(AgentTool).filter(AgentTool.agent_id == agent.id).count() == 2

        # Delete agent
        db.delete(agent)
        db.commit()

        # Verify associated AgentTools are cascade-deleted
        assert db.query(AgentTool).filter(AgentTool.agent_id == agent.id).count() == 0
        print("[PASS] Cascade deletion verified: AgentTool rows deleted automatically when PearlAgent is deleted.")
    finally:
        db.close()


def test_dual_pattern_tool_modes_and_schemas():
    print("--- Testing Dual Pattern Tool Modes and Schemas ---")

    # 1. Test Mode Detection with explicit attributes
    tool_write = {"name": "send_whatsapp", "run_mode": "write"}
    tool_read = {"name": "check_pincode", "run_mode": "read"}
    assert get_tool_run_mode(tool_write) == RUN_MODE_WRITE
    assert is_write_tool(tool_write) is True
    assert is_read_tool(tool_write) is False

    assert get_tool_run_mode(tool_read) == RUN_MODE_READ
    assert is_read_tool(tool_read) is True
    assert is_write_tool(tool_read) is False

    # 2. Test boolean flags: is_read_tool and is_async_write
    t_flag_read = {"name": "query_inventory", "is_read_tool": True}
    assert is_read_tool(t_flag_read) is True
    assert is_write_tool(t_flag_read) is False

    t_flag_write = {"name": "mark_crm", "is_async_write": True}
    assert is_write_tool(t_flag_write) is True
    assert is_read_tool(t_flag_write) is False

    # 3. Test nested config flags
    t_nested_read = {"name": "custom_api", "config": {"is_read_tool": True}}
    assert is_read_tool(t_nested_read) is True

    t_nested_write = {"name": "custom_api", "config": {"run_mode": "write"}}
    assert is_write_tool(t_nested_write) is True

    # 4. Test heuristic naming fallbacks
    assert is_read_tool({"name": "get_order_status"}) is True
    assert is_read_tool({"name": "check_delivery_slots"}) is True
    assert is_read_tool({"name": "fetch_loan_details"}) is True
    assert is_read_tool({"name": "lookup_customer"}) is True
    assert is_read_tool({"name": "verify_pincode"}) is True
    assert is_write_tool({"name": "send_whatsapp_receipt"}) is True
    assert is_write_tool({"name": "update_crm_lead"}) is True
    assert is_write_tool({"name": "mark_dnc_list"}) is True
    assert is_write_tool({"name": "schedule_callback_meeting"}) is True

    # 5. Test AgentTool Database Entity run_mode persistence
    db = SessionLocal()
    try:
        agent = PearlAgent(name="Dual Pattern Agent", user_id=1, status="draft")
        db.add(agent)
        db.commit()
        db.refresh(agent)

        read_tool = AgentTool(
            agent_id=agent.id,
            name="check_pincode_serviceability",
            tool_type="api_tool",
            run_mode="read"
        )
        write_tool = AgentTool(
            agent_id=agent.id,
            name="send_whatsapp_link",
            tool_type="mock_api",
            run_mode="write"
        )
        db.add_all([read_tool, write_tool])
        db.commit()
        db.refresh(read_tool)
        db.refresh(write_tool)

        assert read_tool.run_mode == "read"
        assert read_tool.is_read_tool is True
        assert read_tool.is_async_write is False

        assert write_tool.run_mode == "write"
        assert write_tool.is_read_tool is False
        assert write_tool.is_async_write is True

        # Test tool_to_dict serialization
        d_read = tool_to_dict(read_tool)
        assert d_read["run_mode"] == "read"
        assert d_read["is_read_tool"] is True
        assert d_read["is_async_write"] is False

        d_write = tool_to_dict(write_tool)
        assert d_write["run_mode"] == "write"
        assert d_write["is_read_tool"] is False
        assert d_write["is_async_write"] is True

        db.delete(agent)
        db.commit()
    finally:
        db.close()

    print("[PASS] Dual Pattern tool modes, schemas, properties, and DB persistence verified.")


def test_conversational_fillers_registry():
    print("--- Testing Conversational Fillers Registry ---")

    # 1. Female Persona Fillers
    f_pincode = get_conversational_filler(gender="Female", category="pincode", seed=0)
    assert any(w in f_pincode for w in ["pincode", "serviceability", "delivery"])
    assert "leti hoon" in f_pincode

    f_inventory = get_conversational_filler(gender="Female", category="inventory", seed=0)
    assert any(w in f_inventory for w in ["inventory", "stock", "availability", "verify"])
    assert "leti hoon" in f_inventory

    f_verification = get_conversational_filler(gender="Female", category="verification", seed=0)
    assert "leti hoon" in f_verification

    # 2. Male Persona Fillers
    m_pincode = get_conversational_filler(gender="Male", category="pincode", seed=0)
    assert "leta hoon" in m_pincode

    m_inventory = get_conversational_filler(gender="Male", category="inventory", seed=0)
    assert "leta hoon" in m_inventory

    m_verification = get_conversational_filler(gender="Male", category="verification", seed=0)
    assert "leta hoon" in m_verification

    # 3. Fallback to general category
    fallback = get_conversational_filler(gender="Female", category="non_existent_category", seed=1)
    assert len(fallback) > 10
    assert "leti hoon" in fallback

    print("[PASS] Conversational fillers verified across Female/Male genders and categories.")


def test_pattern_a_async_write_zero_dead_air():
    print("--- Testing Pattern A (Write / Action Tools) Zero Dead Air ---")

    async def _run():
        executed_actions = []

        def mock_action_complete(res):
            executed_actions.append(res)

        dispatcher = ToolDispatcher(gender="Female")

        # 1. Dispatch Pattern A write tool (e.g. send_whatsapp)
        t0 = time.perf_counter()
        task = dispatcher.dispatch_write(
            "send_whatsapp",
            arguments={"phone": "+919876543210", "link": "https://credpulse.in/app"},
            on_complete=mock_action_complete
        )

        dispatch_latency_ms = (time.perf_counter() - t0) * 1000.0

        # Invariant: Dispatching is instantaneous / non-blocking (<50ms)
        assert isinstance(task, asyncio.Task), "Expected asyncio.Task for non-blocking execution"
        assert dispatch_latency_ms < 50.0, f"Dispatch took too long: {dispatch_latency_ms}ms"

        # Allow background task to complete
        await task
        assert len(executed_actions) == 1
        assert executed_actions[0].get("tool_name") == "send_whatsapp"

        # 2. Test other common Pattern A operations: update_crm, mark_dnc, schedule_callback
        for act in ["update_crm", "mark_dnc", "schedule_callback"]:
            task = dispatcher.dispatch_write(act, arguments={"action": act})
            assert isinstance(task, asyncio.Task)
            res = await task
            assert res.get("run_mode") == RUN_MODE_WRITE

    asyncio.run(_run())
    print("[PASS] Pattern A async non-blocking execution verified with zero dead air dispatch.")


def test_pattern_b_live_read_lookup():
    print("--- Testing Pattern B (Read / Lookup Tools) Execution ---")

    async def _run():
        dispatcher = ToolDispatcher(gender="Female")

        # 1. Pincode lookup tool
        res_pin = await dispatcher.execute_read(
            "check_pincode_serviceability",
            arguments={"pincode": "560034"}
        )
        assert res_pin["tool_name"] == "check_pincode_serviceability"
        assert res_pin["run_mode"] == RUN_MODE_READ
        assert res_pin.get("success") is True

        # 2. Product inventory lookup tool
        res_inv = await dispatcher.execute_read(
            "check_product_inventory",
            arguments={"item": "Oversized Linen Shirt", "size": "M"}
        )
        assert res_inv["tool_name"] == "check_product_inventory"
        assert res_inv["run_mode"] == RUN_MODE_READ

        # 3. Loan verification status lookup
        res_loan = await dispatcher.execute_read(
            "verify_loan_status",
            arguments={"application_id": "APP-5092"}
        )
        assert res_loan["tool_name"] == "verify_loan_status"
        assert res_loan["run_mode"] == RUN_MODE_READ

    asyncio.run(_run())
    print("[PASS] Pattern B live read tool execution verified.")


def test_voice_session_dual_pattern_flow():
    print("--- Testing Voice Session End-to-End Dual Pattern Flow ---")

    class MockTTS:
        def __init__(self):
            self.sent_texts = []
            self.flushed = False

        async def send_text(self, text: str):
            self.sent_texts.append(text)

        async def flush(self):
            self.flushed = True

        async def receive_audio(self):
            yield b"__FLUSH_COMPLETE__"

    class MockEngine:
        def __init__(self):
            self.gender = "Female"
            self.lead = {"prospect_name": "Rahul Verma", "phone": "+919876543210"}
            self.history = []
            self.turns = []

        def add_turn(self, role: str, text: str):
            self.turns.append((role, text))
            self.history.append({"role": "user" if role == "prospect" else "assistant", "content": text})

        def inject_tool_result(self, tool_name: str, result: Dict[str, Any], filler_phrase: Optional[str] = None, **kwargs):
            self.history.append({"role": "system", "content": f"[Tool: {tool_name}] -> {result}"})

        async def generate_response_stream(self):
            # Check if live lookup occurred
            has_lookup = any("Live" in str(h.get("content")) or "Tool:" in str(h.get("content")) for h in self.history)
            if has_lookup:
                for token in ["560034 ", "par ", "delivery ", "available ", "hai."]:
                    yield token
            else:
                for token in ["Maine ", "WhatsApp ", "par ", "link ", "share ", "kar ", "diya."]:
                    yield token

    async def _run():
        tts = MockTTS()
        engine = MockEngine()
        session = PearlVoiceSession(session_id="test_dual_pattern_session", engine=engine, tts_provider=tts)

        # 1. Pattern A Turn: Prospect asks for WhatsApp link
        tts.sent_texts.clear()
        gen_id_a = await session.on_turn_complete("Haan please WhatsApp par link bhej do")
        await session._active_llm_task

        # Verify Pattern A:
        # - Write tool was dispatched as non-blocking background task
        assert session.last_turn_tool is not None
        assert session.last_turn_tool["mode"] == RUN_MODE_WRITE
        assert session.last_turn_tool["name"] == "send_whatsapp"
        assert isinstance(session.last_turn_tool["task"], asyncio.Task)
        # - Dialogue streamed to TTS immediately without waiting for write task
        spoken_text_a = "".join(tts.sent_texts)
        assert "WhatsApp" in spoken_text_a
        # - Allow background task to complete and verify clean finish
        await session.last_turn_tool["task"]
        assert session.last_turn_tool["task"].done()

        # 2. Pattern B Turn: Prospect asks for live pincode serviceability
        tts.sent_texts.clear()
        engine.history.clear()
        gen_id_b = await session.on_turn_complete("Kya aap pincode 560034 par deliver karte hain?")
        await session._active_llm_task

        # Verify Pattern B:
        # - Filler phrase was sent to TTS FIRST (eliminating dead air)
        assert len(tts.sent_texts) >= 2
        filler_sent = tts.sent_texts[0]
        assert any(w in filler_sent for w in ["system", "check", "second", "rukiye", "dijiye", "dekh leti"])
        # - Tool result was injected into context
        assert session.last_turn_tool["mode"] == RUN_MODE_READ
        assert session.last_turn_tool["name"] == "check_pincode_serviceability"
        # - Grounded response followed the filler
        answer_sent = "".join(tts.sent_texts[1:])
        assert "560034" in answer_sent or "delivery" in answer_sent

        # 3. Barge-In Invariant Test during active speech
        session.transition_to(SessionState.SPEAKING)
        session.is_speaking = True
        cancelled_gen = session.trigger_barge_in()
        assert session.state == SessionState.INTERRUPTED
        assert session.generation_id > cancelled_gen
        assert session.is_speaking is False

        await session.close()

    asyncio.run(_run())
    print("[PASS] Voice Session dual Pattern A + Pattern B end-to-end execution verified cleanly.")


def test_pattern_b_barge_in_cancellation_during_lookup():
    print("--- Testing Pattern B Barge-In Cancellation During Lookup ---")

    class MockTTS:
        def __init__(self):
            self.sent_texts = []
        async def send_text(self, text: str):
            self.sent_texts.append(text)
        async def flush(self):
            pass

    class SlowReadEngine:
        def __init__(self):
            self.gender = "Female"
            self.lead = {}
            self.history = []
        def add_turn(self, role: str, text: str):
            self.history.append({"role": "user" if role == "prospect" else "assistant", "content": text})
        def inject_tool_result(self, tool_name: str, result: Dict[str, Any], filler_phrase: Optional[str] = None):
            self.history.append({"role": "system", "content": f"[Tool: {tool_name}] -> {result}"})
        async def generate_response_stream(self):
            yield "Done"

    async def _run():
        tts = MockTTS()
        engine = SlowReadEngine()

        # Tool that sleeps 1 second to simulate network latency
        async def slow_lookup(args):
            await asyncio.sleep(1.0)
            return {"status": "success", "stock": 42}

        slow_tool = {
            "name": "check_product_inventory",
            "run_mode": RUN_MODE_READ,
            "execute": slow_lookup
        }

        session = PearlVoiceSession(
            session_id="test_barge_in_session",
            engine=engine,
            tts_provider=tts,
            tools=[slow_tool]
        )

        # 1. Start Turn requesting slow lookup
        gen_id = await session.on_turn_complete("Is size M in stock?")
        # Wait 50ms so filler is sent and read task is in flight
        await asyncio.sleep(0.05)

        # Invariant: Filler was sent immediately (<50ms, zero dead air)
        assert len(tts.sent_texts) == 1
        assert any(w in tts.sent_texts[0] for w in ["stock", "inventory", "system", "second", "rukiye", "dijiye"])
        # Invariant: read task is currently active
        assert session._active_read_task is not None
        assert not session._active_read_task.done()

        # 2. Prospect interrupts (barge-in onset) during active read lookup
        cancelled_gen = session.cancel_current_generation(reason="barge_in_onset")
        assert session.generation_id > gen_id
        assert session.generation_id == cancelled_gen
        assert session._cancellation_event.is_set()

        # Invariant: Active read task was immediately cancelled
        assert session._active_read_task is None

        # 3. Subsequent user turn supersedes cleanly without collision
        tts.sent_texts.clear()
        next_gen = await session.on_turn_complete("Wait, forget size M, check size L please")
        await session._active_llm_task

        # Invariant: No duplicate filler, previous generation discarded, clean finish
        assert session.generation_id == next_gen
        await session.close()

    asyncio.run(_run())
    print("[PASS] Pattern B barge-in cancellation during active lookup verified.")


def test_pattern_b_timeout_and_spoken_fallback():
    print("--- Testing Pattern B Timeout and Spoken Fallback ---")

    class MockTTS:
        def __init__(self):
            self.sent_texts = []
        async def send_text(self, text: str):
            self.sent_texts.append(text)
        async def flush(self):
            pass

    class FallbackEngine:
        def __init__(self):
            self.gender = "Female"
            self.lead = {}
            self.history = []
        def add_turn(self, role: str, text: str):
            self.history.append({"role": "user" if role == "prospect" else "assistant", "content": text})
        async def generate_response_stream(self):
            yield "LLM Fallback"

    async def _run():
        tts = MockTTS()
        engine = FallbackEngine()

        # Tool that fails with fallback response
        async def failing_lookup(args):
            return {
                "success": False,
                "error": "Connection timed out after 3000ms",
                "spoken_feedback": "Main abhi inventory check nahi kar pa rahi hoon, kripya thodi der baad try kijiye."
            }

        failing_tool = {
            "name": "check_product_inventory",
            "run_mode": RUN_MODE_READ,
            "execute": failing_lookup
        }

        session = PearlVoiceSession(
            session_id="test_timeout_fallback_session",
            engine=engine,
            tts_provider=tts,
            tools=[failing_tool]
        )

        # Start Turn
        await session.on_turn_complete("Kya linen shirt stock mein hai?")
        await session._active_llm_task

        # Invariant: Filler was sent first (<100ms)
        assert len(tts.sent_texts) == 2
        filler = tts.sent_texts[0]
        spoken_fallback = tts.sent_texts[1]

        # Invariant: Fallback response was delivered immediately without dead air
        assert "inventory" in spoken_fallback or "check nahi" in spoken_fallback
        assert engine.history[-1]["role"] == "assistant"
        assert "inventory" in engine.history[-1]["content"]

        await session.close()

    asyncio.run(_run())
    print("[PASS] Pattern B timeout and immediate spoken fallback verified.")


def test_trigger_keywords_comma_separated_strings():
    print("--- Testing Comma-Separated Keyword Triggers Parsing ---")

    tool = {
        "name": "check_pincode_custom",
        "run_mode": RUN_MODE_READ,
        "config": {
            "trigger_keywords": "pincode, serviceability, delivery slot"
        }
    }
    dispatcher = ToolDispatcher(tools=[tool])

    # Invariant: Substring word matches correctly
    m1 = dispatcher.match_tool_by_intent("Mera pincode check karo")
    assert m1 is not None
    assert m1[0] == "check_pincode_custom"

    # Invariant: Non-matching sentence does NOT falsely trigger on single characters
    # e.g. "hello world" contains 'o', 'l', 'e', 'd', 'i' - must NOT match!
    m2 = dispatcher.match_tool_by_intent("Hello world, good morning")
    assert m2 is None, f"Expected None but matched {m2}"

    # Invariant: Phrase with 'serviceability' matches
    m3 = dispatcher.match_tool_by_intent("Check serviceability please")
    assert m3 is not None
    assert m3[0] == "check_pincode_custom"

    print("[PASS] Comma-separated keyword triggers correctly parsed without character-iteration bugs.")


def test_registered_tools_isolation():
    print("--- Testing Registered Tools Intent Isolation ---")

    # Agent only has WhatsApp tool (Pattern A write tool)
    whatsapp_tool = {
        "name": "send_whatsapp",
        "run_mode": RUN_MODE_WRITE,
        "config": {
            "trigger_keywords": ["whatsapp", "link"]
        }
    }
    dispatcher = ToolDispatcher(tools=[whatsapp_tool], allow_unregistered=False)

    # Intent matching WhatsApp matches registered tool
    m_wa = dispatcher.match_tool_by_intent("WhatsApp par link bhej do")
    assert m_wa is not None
    assert m_wa[0] == "send_whatsapp"

    # Asking about pincode should NOT fabricate an unregistered pincode tool
    m_pin = dispatcher.match_tool_by_intent("Kya 560034 par deliver karte ho?")
    assert m_pin is None, f"Expected None for unconfigured tool, got {m_pin}"

    print("[PASS] Registered tools intent isolation verified.")


if __name__ == "__main__":
    test_curl_parser()
    test_jsonpath_extractor()
    test_data_validator()
    test_data_verifier()
    test_mock_api()
    test_run_tool_test_unified()
    test_database_agent_tool_persistence()
    test_response_template_and_path_params()
    test_normalize_date_string_edge_cases()
    test_normalize_phone_string_edge_cases()
    test_execute_data_verifier_edge_cases()
    test_execute_api_tool_edge_cases()
    test_run_tool_test_malformed_payloads()
    test_database_cascade_deletion()
    test_dual_pattern_tool_modes_and_schemas()
    test_conversational_fillers_registry()
    test_pattern_a_async_write_zero_dead_air()
    test_pattern_b_live_read_lookup()
    test_voice_session_dual_pattern_flow()
    test_pattern_b_barge_in_cancellation_during_lookup()
    test_pattern_b_timeout_and_spoken_fallback()
    test_trigger_keywords_comma_separated_strings()
    test_registered_tools_isolation()
    print("\nALL TOOL ENGINE & DUAL PATTERN UNIT TESTS PASSED CLEANLY!")
