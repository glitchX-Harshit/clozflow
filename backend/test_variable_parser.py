"""
Test script for backend variable parser and sales archetypes.
"""
from utils.variable_parser import extract_variables_from_text, substitute_variables_text
from data.sales_archetypes import get_all_archetypes, get_archetype_by_id

def test_archetypes():
    archetypes = get_all_archetypes()
    assert len(archetypes) == 5, f"Expected 5 archetypes, got {len(archetypes)}"
    
    expected_ids = [
        "fintech_kyc_recovery",
        "d2c_cod_confirmation",
        "cart_recovery_closer",
        "b2b_discovery_qualifier",
        "ndr_delivery_rescuer"
    ]
    
    for aid in expected_ids:
        arch = get_archetype_by_id(aid)
        assert arch is not None, f"Archetype {aid} not found"
        assert arch.get("name"), f"Missing name in {aid}"
        assert arch.get("systemPrompt") or arch.get("system_prompt"), f"Missing system prompt in {aid}"
        assert arch.get("greeting"), f"Missing greeting in {aid}"
        assert arch.get("supportedVariables") or arch.get("supported_variables"), f"Missing supported variables in {aid}"
        assert arch.get("objectionPlaybooks") or arch.get("objection_playbooks"), f"Missing objection playbooks in {aid}"
        assert arch.get("defaultVoiceId") or arch.get("default_voice_id"), f"Missing default voice in {aid}"
    print("[OK] All 5 backend archetypes verified")

def test_variable_parser():
    text = 'Namaste {{customer_name | "Ji"}}, total is {{order_value | ₹1,899}}. Contact {{brand_name | \'Snitch\'}} at {{link}}.'
    extracted = extract_variables_from_text(text)
    assert len(extracted) == 4, f"Expected 4 variables, got {len(extracted)}"
    
    assert extracted[0]["name"] == "customer_name"
    assert extracted[0]["fallback"] == "Ji"
    assert extracted[1]["name"] == "order_value"
    assert extracted[1]["fallback"] == "₹1,899"
    assert extracted[2]["name"] == "brand_name"
    assert extracted[2]["fallback"] == "Snitch"
    assert extracted[3]["name"] == "link"
    assert extracted[3]["fallback"] == ""
    
    # Test substitution
    sub = substitute_variables_text(text, {"customer_name": "Deepak", "link": "https://snitch.co.in"})
    assert "Namaste Deepak" in sub
    assert "total is ₹1,899" in sub
    assert "Contact Snitch" in sub
    assert "at https://snitch.co.in" in sub
    
    # Test whitespace tolerance
    ws_text = 'Hello {{  name  |  "Sir"  }}!'
    sub_ws = substitute_variables_text(ws_text, {})
    assert sub_ws == "Hello Sir!"
    
    # Test unquoted fallback
    unq_text = 'Valid for {{duration | 24 hours}}'
    sub_unq = substitute_variables_text(unq_text, {})
    assert sub_unq == "Valid for 24 hours"
    
    print("[OK] Backend variable parser verified")

if __name__ == "__main__":
    test_archetypes()
    test_variable_parser()
    print("ALL BACKEND TESTS PASSED!")
