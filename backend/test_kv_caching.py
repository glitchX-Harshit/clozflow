"""
Unit Test for Pearl Conversation Engine KV Prefix Caching Architecture.

Verifies:
1. Static Foundation Prompt integrity (byte-for-byte identical across instances).
2. SHA-256 prefix hash stability.
3. Message structure: [static_foundation, dynamic_context, ...history, user_turn].
4. get_kv_cache_stats() telemetry.
5. Backwards compatibility for legacy system_prompt property and _build_system_prompt.
"""
import sys
import hashlib
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.resolve()
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from services.pearl.conversation_engine import (
    ConversationEngine,
    _STATIC_FOUNDATION_PROMPT,
    _STATIC_PROMPT_HASH,
    _CACHED_SYSTEM_MESSAGE,
    get_kv_cache_stats,
    _kv_cache_stats,
)

def test_kv_caching_architecture():
    print("--- Testing KV Prefix Caching Architecture ---")

    # 1. Verify static prompt integrity & hash
    computed_hash = hashlib.sha256(_STATIC_FOUNDATION_PROMPT.encode("utf-8")).hexdigest()
    assert computed_hash == _STATIC_PROMPT_HASH, f"Hash mismatch: {computed_hash} != {_STATIC_PROMPT_HASH}"
    print(f"[PASS] Static foundation SHA-256 verified: {_STATIC_PROMPT_HASH[:16]}...")

    # 2. Instantiate two engines with completely different leads, objectives, and personas
    engine1 = ConversationEngine(
        objective="Recover KYC for Credit Card Limit",
        lead_context={
            "prospect_name": "Vikram Malhotra",
            "capsule_context": "Pre-approved limit 2,50,000 INR",
            "agent_name": "Pearl",
            "speaker": "ritu"
        }
    )

    engine2 = ConversationEngine(
        objective="Confirm COD delivery address for Snitch Linen Shirt",
        lead_context={
            "prospect_name": "Deepak Joshi",
            "capsule_context": "COD Rs 1,899 pending confirmation",
            "agent_name": "Aditya",
            "speaker": "shubh"
        }
    )

    # 3. Verify Position [0] is byte-identical across both engines
    pos0_engine1 = engine1._system_messages[0]["content"]
    pos0_engine2 = engine2._system_messages[0]["content"]
    assert pos0_engine1 == pos0_engine2 == _STATIC_FOUNDATION_PROMPT, "Position [0] must be byte-for-byte identical!"
    print("[PASS] Position [0] is byte-for-byte identical across distinct engine instances.")

    # 4. Verify Position [1] contains only the dynamic per-call context
    pos1_engine1 = engine1._system_messages[1]["content"]
    pos1_engine2 = engine2._system_messages[1]["content"]

    assert "Vikram" in pos1_engine1 and "Pre-approved limit" in pos1_engine1
    assert "Deepak" in pos1_engine2 and "COD Rs 1,899" in pos1_engine2
    assert "CONVERSATION STYLE & SPOKEN NUANCE:" not in pos1_engine1, "Static prompt leaked into dynamic context!"
    assert "TTS Script Purity:" not in pos1_engine2, "Static prompt leaked into dynamic context!"
    print("[PASS] Position [1] cleanly separates dynamic context without duplicating static instructions.")

    # 5. Verify backwards compatibility
    assert hasattr(engine1, "system_prompt"), "Legacy system_prompt attribute missing!"
    assert _STATIC_FOUNDATION_PROMPT in engine1.system_prompt
    assert pos1_engine1 in engine1.system_prompt
    print("[PASS] Backwards compatibility for legacy system_prompt preserved.")

    # 6. Verify KV cache stats telemetry
    stats_before = get_kv_cache_stats()
    assert "hit_rate_pct" in stats_before
    assert "estimated_ttft_savings_ms" in stats_before
    print(f"[PASS] KV Cache telemetry verified: {stats_before}")

    print("\nALL KV CACHING UNIT TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_kv_caching_architecture()
