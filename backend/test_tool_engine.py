"""
Test Suite: Pearl Tool Execution Engine & AgentTool Models
Verifies cURL parsing, API tool execution, regex validation, verifier matching,
mock simulation, JSONPath extraction, and SQLite database persistence.
"""
import asyncio
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.pearl.tool_engine import (
    parse_curl_command,
    extract_json_path,
    execute_data_validator,
    execute_data_verifier,
    execute_mock_api,
    run_tool_test
)
from database import engine, Base, SessionLocal
from models_pearl import PearlAgent, AgentTool
from models import User


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

    # 1. Phone number with formatting strip
    cfg_verifier_phone = {
        "normalization": "strip_phone_formatting",
        "match_mode": "exact_match",
        "spoken_on_match": "Phone confirmed",
        "spoken_on_mismatch": "Phone mismatch"
    }
    res_phone = execute_data_verifier(cfg_verifier_phone, "+91 98765-43210", "09876543210")
    assert res_phone["is_match"] is True
    assert res_phone["spoken_feedback"] == "Phone confirmed"

    # 2. Lowercase name match
    cfg_name = {
        "normalization": "lowercase",
        "match_mode": "exact_match"
    }
    res_name = execute_data_verifier(cfg_name, "  Siddharth Roy  ", "siddharth roy")
    assert res_name["is_match"] is True

    # 3. Contains mode (e.g. last 4 digits of card/account or partial order number)
    cfg_contains = {
        "normalization": "strip_phone_formatting",
        "match_mode": "contains"
    }
    res_contains = execute_data_verifier(cfg_contains, "3210", "9876543210")
    assert res_contains["is_match"] is True

    # 4. Mismatch case
    res_mismatch = execute_data_verifier(cfg_contains, "9999", "9876543210")
    assert res_mismatch["is_match"] is False

    # 5. Empty reference security check (empty normalized ref must NOT match)
    res_empty_ref = execute_data_verifier(cfg_contains, "1234", "---")
    assert res_empty_ref["is_match"] is False

    # 6. Integer 0 handling
    res_zero = execute_data_verifier({"normalization": "none", "match_mode": "exact_match"}, 0, "0")
    assert res_zero["is_match"] is True

    print("[PASS] Data Verifier verified with phone normalization, contains mode, and empty-ref security.")


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

    # Dynamic reference_source resolution for verifier
    cfg_ver = {
        "reference_source": "lead.phone",
        "match_mode": "contains",
        "normalization": "strip_phone_formatting"
    }
    res_ver = asyncio.run(run_tool_test("data_verifier", cfg_ver, test_input={"spoken_value": "4321", "lead": {"phone": "+91 98765 44321"}}))
    assert res_ver["is_match"] is True

    print("[PASS] Unified test runner verified with dynamic source inputs.")


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

        # Verify query and relationship
        fetched_agent = db.query(PearlAgent).filter(PearlAgent.id == test_agent.id).first()
        assert len(fetched_agent.tools) == 1
        assert fetched_agent.tools[0].name == "lookup_order_status"
        assert fetched_agent.tools[0].tool_type == "api_tool"
        assert fetched_agent.tools[0].config["method"] == "GET"

        # Cleanup test records
        db.delete(tool)
        db.delete(test_agent)
        db.commit()
        print("[PASS] AgentTool database persistence & relationship verified.")
    finally:
        db.close()


if __name__ == "__main__":
    test_curl_parser()
    test_jsonpath_extractor()
    test_data_validator()
    test_data_verifier()
    test_mock_api()
    test_run_tool_test_unified()
    test_database_agent_tool_persistence()
    print("\nALL TOOL ENGINE UNIT TESTS PASSED CLEANLY!")
