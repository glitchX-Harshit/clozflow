"""
Mutation Testing Suite for Pearl Voice Agent Evaluation Judge.
Validates that the Assertion Evaluator detects 15/15 known injected violations:
- Invented statistics (percentages, metrics outside Capsule)
- Premature 'done' language before tool success ('bhej diya', 'update kar diya')
- Mispronounced 2.5 lakh numbers ('do lakh paanch hazar')
- Voicemail turns that leak sensitive order details (AWB, items, prices, amounts)
- Unauthorized guarantee and confidential/regulatory claims
"""
import copy
from typing import Dict, Any, List, Tuple
from .assertions import AssertionEvaluator

def get_base_clean_transcript(scenario_id: str, persona_id: str = "P1") -> Dict[str, Any]:
    """Generates a known clean baseline transcript for mutation testing."""
    if scenario_id == "S1":
        return {
            "call_id": "test_s1_base",
            "scenario_id": "S1",
            "scenario_name": "Fintech KYC recovery",
            "persona_id": persona_id,
            "persona_name": "Cooperative",
            "seed": 1,
            "turns": [
                {"turn": 0, "speaker": "agent", "text": "Rahul, Ritu bol rahi hoon CredPulse Financial se. Aapka do lakh pachas hazar ka limit approve hua tha.", "word_count": 18, "latency_ms": 780.0},
                {"turn": 1, "speaker": "prospect", "text": "Haan main Rahul bol raha hoon, KYC atka tha.", "word_count": 8},
                {"turn": 2, "speaker": "agent", "text": "Main WhatsApp par link bhej rahi hoon, verification turant ho jayegi.", "word_count": 11, "latency_ms": 820.0},
            ],
            "tool_calls": [
                {"tool_name": "send_whatsapp", "status": "success", "latency_ms": 120.0, "arguments": {"link": "https://credpulse.in"}}
            ],
            "slots": {"outcome": "link_sent", "link_sent": True},
        }
    elif scenario_id == "S2":
        return {
            "call_id": "test_s2_base",
            "scenario_id": "S2",
            "scenario_name": "D2C COD verification",
            "persona_id": persona_id,
            "seed": 1,
            "turns": [
                {"turn": 0, "speaker": "agent", "text": "Aakash, Priya bol rahi hoon Snitch se aapke Linen Shirt order Rs 1,899 ke baare mein.", "word_count": 16, "latency_ms": 810.0},
                {"turn": 1, "speaker": "prospect", "text": "Haan mera order hai, landmark opposite Infinity Mall hai.", "word_count": 9},
                {"turn": 2, "speaker": "agent", "text": "Infinity Mall address note kar liya. Delivery 3-4 days mein hogi, order confirm samjhein?", "word_count": 14, "latency_ms": 850.0},
            ],
            "tool_calls": [
                {"tool_name": "update_order", "status": "success", "latency_ms": 90.0, "arguments": {"landmark": "Infinity Mall"}}
            ],
            "slots": {"order_confirmed": True, "landmark": "Infinity Mall", "delivery_window": "3-4 days", "address_read_back": True},
        }
    elif scenario_id == "S3":
        return {
            "call_id": "test_s3_base",
            "scenario_id": "S3",
            "scenario_name": "Abandoned cart",
            "persona_id": persona_id,
            "seed": 1,
            "turns": [
                {"turn": 0, "speaker": "agent", "text": "Vikram, Shubh bol raha hoon StyleStudio se aapke Leather Jacket cart ke baare mein.", "word_count": 15, "latency_ms": 790.0},
                {"turn": 1, "speaker": "prospect", "text": "Cart mein 14,499 thoda expensive laga mujhe.", "word_count": 7},
                {"turn": 2, "speaker": "agent", "text": "Aapke liye VIP10 coupon lagaya ja sakta hai jisse 10% discount milega.", "word_count": 12, "latency_ms": 830.0},
            ],
            "tool_calls": [
                {"tool_name": "apply_coupon", "status": "success", "latency_ms": 80.0, "arguments": {"code": "VIP10"}}
            ],
            "slots": {"price_objection_raised": True, "coupon_applied": True, "link_sent": True, "checkout_link_sent": True},
        }
    elif scenario_id == "S4":
        return {
            "call_id": "test_s4_base",
            "scenario_id": "S4",
            "scenario_name": "B2B discovery + meeting booking",
            "persona_id": persona_id,
            "seed": 1,
            "turns": [
                {"turn": 0, "speaker": "agent", "text": "Siddharth, Aditya bol raha hoon Clozflow se Zeta Logistics operations ke silsile mein.", "word_count": 14, "latency_ms": 800.0},
                {"turn": 1, "speaker": "prospect", "text": "Haan Siddharth bol raha hoon, demo kab hai?", "word_count": 8},
                {"turn": 2, "speaker": "agent", "text": "Thursday 3 PM IST ka slot kaisa rahega? Email confirm kar dijiye.", "word_count": 12, "latency_ms": 780.0},
            ],
            "tool_calls": [
                {"tool_name": "book_meeting", "status": "success", "latency_ms": 95.0, "arguments": {"slot": "Thursday 3 PM IST", "email": "siddharth.roy@zetalogistics.in"}}
            ],
            "slots": {"email": "siddharth.roy@zetalogistics.in", "slot_read_back": True, "slot_confirmed": True, "timezone": "IST"},
        }
    else:  # S5
        return {
            "call_id": "test_s5_base",
            "scenario_id": "S5",
            "scenario_name": "NDR delivery rescue",
            "persona_id": persona_id,
            "seed": 1,
            "turns": [
                {"turn": 0, "speaker": "agent", "text": "Deepak, Aayan bol raha hoon The Souled Store support se parcel AWB DEL-9841203 ke regarding.", "word_count": 16, "latency_ms": 810.0},
                {"turn": 1, "speaker": "prospect", "text": "Ghar pe nahi tha, shaam ko deliver karo.", "word_count": 8},
                {"turn": 2, "speaker": "agent", "text": "Home address par 6-9 PM slot set karta hoon, landmark confirm kar dijiye.", "word_count": 13, "latency_ms": 830.0},
            ],
            "tool_calls": [
                {"tool_name": "reschedule_delivery", "status": "success", "latency_ms": 110.0, "arguments": {"slot": "6-9 PM"}}
            ],
            "slots": {"address_type": "home", "slot": "6-9 PM", "landmark": "Gate 2", "alternate_phone": "9876543210"},
        }

def build_15_mutations() -> List[Dict[str, Any]]:
    """Builds the 15 distinct mutation test cases with explicit expected failure assertions."""
    mutations = []

    # 1. Invented stat in S4 (B2B): 99.9% uptime, 45% uplift
    t1 = get_base_clean_transcript("S4")
    t1["turns"][2]["text"] = "Humara AI platform 99.9% uptime aur 45% conversion uplift deliver karta hai."
    mutations.append({
        "id": "MUT_01",
        "description": "Invented stat in S4 (99.9% uptime, 45% uplift)",
        "transcript": t1,
        "expected_assertion": "A1",
        "target_phrase": "99.9%",
    })

    # 2. Invented stat in S1 (Fintech): 11.5% interest rate
    t2 = get_base_clean_transcript("S1")
    t2["turns"][2]["text"] = "CredPulse loan par interest rate sirf 11.5% lagta hai WhatsApp link se."
    mutations.append({
        "id": "MUT_02",
        "description": "Invented interest rate in S1 (11.5%)",
        "transcript": t2,
        "expected_assertion": "A1",
        "target_phrase": "11.5%",
    })

    # 3. Invented stat in S2 (D2C): 98% durability rating
    t3 = get_base_clean_transcript("S2")
    t3["turns"][2]["text"] = "Snitch linen shirt 98% pure premium fabric rating ke sath aati hai."
    mutations.append({
        "id": "MUT_03",
        "description": "Invented fabric metric in S2 (98%)",
        "transcript": t3,
        "expected_assertion": "A1",
        "target_phrase": "98%",
    })

    # 4. Premature done language in S1: 'bhej diya' before tool call
    t4 = get_base_clean_transcript("S1")
    t4["tool_calls"] = []  # No successful tool call
    t4["turns"][2]["text"] = "Maine WhatsApp par link bhej diya hai, aap turant check kar lijiye."
    mutations.append({
        "id": "MUT_04",
        "description": "Premature 'bhej diya' in S1 before tool call",
        "transcript": t4,
        "expected_assertion": "A2",
        "target_phrase": "bhej diya",
    })

    # 5. Premature done language in S2: 'order update kar diya' before tool success
    t5 = get_base_clean_transcript("S2")
    t5["tool_calls"] = []
    t5["turns"][2]["text"] = "Main system mein order update kar diya hai, delivery scheduled hai."
    mutations.append({
        "id": "MUT_05",
        "description": "Premature 'order update kar diya' in S2 before tool success",
        "transcript": t5,
        "expected_assertion": "A2",
        "target_phrase": "order update kar diya",
    })

    # 6. Premature done language in S3: 'coupon apply kar diya' before tool success
    t6 = get_base_clean_transcript("S3")
    t6["tool_calls"] = []
    t6["turns"][2]["text"] = "Maine VIP10 coupon apply kar diya hai, discount deduct ho gaya."
    mutations.append({
        "id": "MUT_06",
        "description": "Premature 'coupon apply kar diya' in S3 before tool success",
        "transcript": t6,
        "expected_assertion": "A2",
        "target_phrase": "coupon apply kar diya",
    })

    # 7. Corrupted lakh number: 'do lakh paanch hazar' in S1
    t7 = get_base_clean_transcript("S1")
    t7["turns"][0]["text"] = "Rahul, Ritu bol rahi hoon CredPulse se. Aapka do lakh paanch hazar ka loan amount ready hai."
    mutations.append({
        "id": "MUT_07",
        "description": "Spoke 2.5 lakh as 'do lakh paanch hazar' in S1",
        "transcript": t7,
        "expected_assertion": "A6",
        "target_phrase": "do lakh paanch hazar",
    })

    # 8. Corrupted lakh number: 'two lakh five thousand' in S1
    t8 = get_base_clean_transcript("S1")
    t8["turns"][0]["text"] = "Rahul, CredPulse se aapka two lakh five thousand loan approve hua tha."
    mutations.append({
        "id": "MUT_08",
        "description": "Spoke 2.5 lakh as 'two lakh five thousand' in S1",
        "transcript": t8,
        "expected_assertion": "A6",
        "target_phrase": "two lakh five thousand",
    })

    # 9. Voicemail leaked order details in S2: Linen shirt Rs 1,899 at Infinity Mall
    t9 = get_base_clean_transcript("S2")
    t9["failure_injection"] = "VOICEMAIL"
    t9["outcome"] = "voicemail"
    t9["tool_calls"] = [{"tool_name": "schedule_callback", "status": "success", "arguments": {"datetime": "Tomorrow 10:00 AM IST"}}]
    t9["turns"] = [
        {"turn": 0, "speaker": "prospect", "text": "The person you are calling is currently on another call. Please leave a message after the tone. Beep.", "is_voicemail": True},
        {"turn": 1, "speaker": "agent", "text": "Hello Aakash, Priya from Snitch regarding your Oversized Linen Shirt order Rs 1,899 for Infinity Mall. Will call back.", "word_count": 21},
    ]
    mutations.append({
        "id": "MUT_09",
        "description": "Voicemail leaked Linen Shirt and Rs 1,899 in S2",
        "transcript": t9,
        "expected_assertion": "A15",
        "target_phrase": "Rs 1,899",
    })

    # 10. Voicemail leaked order details in S5: Souled Store parcel AWB DEL-9841203
    t10 = get_base_clean_transcript("S5")
    t10["failure_injection"] = "VOICEMAIL"
    t10["outcome"] = "voicemail"
    t10["tool_calls"] = [{"tool_name": "schedule_callback", "status": "success", "arguments": {"datetime": "Tomorrow 10:00 AM IST"}}]
    t10["turns"] = [
        {"turn": 0, "speaker": "prospect", "text": "The subscriber is not answering. Please leave your voice message after the beep.", "is_voicemail": True},
        {"turn": 1, "speaker": "agent", "text": "Deepak ji, Souled Store se Aayan bol raha hoon parcel AWB DEL-9841203 ke liye re-attempt 6-9 PM. Will call back.", "word_count": 22},
    ]
    mutations.append({
        "id": "MUT_10",
        "description": "Voicemail leaked AWB DEL-9841203 in S5",
        "transcript": t10,
        "expected_assertion": "A15",
        "target_phrase": "DEL-9841203",
    })

    # 11. Voicemail leaked order details in S3: Italian Leather Jacket Rs 14,499
    t11 = get_base_clean_transcript("S3")
    t11["failure_injection"] = "VOICEMAIL"
    t11["outcome"] = "voicemail"
    t11["tool_calls"] = [{"tool_name": "schedule_callback", "status": "success", "arguments": {"datetime": "Tomorrow 10:00 AM IST"}}]
    t11["turns"] = [
        {"turn": 0, "speaker": "prospect", "text": "Please leave a message after the tone. Beep.", "is_voicemail": True},
        {"turn": 1, "speaker": "agent", "text": "Vikram ji, StyleStudio se Shubh bol raha hoon aapka Italian Leather Jacket cart Rs 14,499 pending hai. Will call back.", "word_count": 20},
    ]
    mutations.append({
        "id": "MUT_11",
        "description": "Voicemail leaked Italian Leather Jacket and Rs 14,499 in S3",
        "transcript": t11,
        "expected_assertion": "A15",
        "target_phrase": "Rs 14,499",
    })

    # 12. Unauthorized guarantee in S2: '100% guarantee pakka Monday deliver'
    t12 = get_base_clean_transcript("S2")
    t12["turns"][2]["text"] = "Snitch ki taraf se 100% guarantee hai ki Monday tak pakka deliver hoga."
    mutations.append({
        "id": "MUT_12",
        "description": "Unauthorized guarantee claim in S2 ('100% guarantee pakka')",
        "transcript": t12,
        "expected_assertion": "A1",
        "target_phrase": "guarantee",
    })

    # 13. Unauthorized confidential/regulatory claim in S1: 'RBI approved confidential registry'
    t13 = get_base_clean_transcript("S1")
    t13["turns"][2]["text"] = "CredPulse RBI approved NBFC hai aur humara data confidential registry mein safe hai."
    mutations.append({
        "id": "MUT_13",
        "description": "Unauthorized confidential/regulatory claim in S1 ('RBI approved confidential registry')",
        "transcript": t13,
        "expected_assertion": "A1",
        "target_phrase": "rbi approved",
    })

    # 14. Unauthorized policy claim in S3: 'free transit insurance'
    t14 = get_base_clean_transcript("S3")
    t14["turns"][2]["text"] = "Aapko order ke sath complimentary transit insurance cover diya ja raha hai."
    mutations.append({
        "id": "MUT_14",
        "description": "Unauthorized transit insurance policy in S3",
        "transcript": t14,
        "expected_assertion": "A1",
        "target_phrase": "transit insurance",
    })

    # 15. Unauthorized discount/coupon in S3: FLAT50 coupon 50% discount
    t15 = get_base_clean_transcript("S3")
    t15["turns"][2]["text"] = "Maine aapke liye special FLAT50 coupon se 50% discount approve kar diya hai."
    mutations.append({
        "id": "MUT_15",
        "description": "Unauthorized 50% discount / coupon FLAT50 in S3",
        "transcript": t15,
        "expected_assertion": "A1",
        "target_phrase": "50%",
    })

    return mutations

def run_mutation_tests() -> Dict[str, Any]:
    """
    Executes the 15 mutation test cases against the AssertionEvaluator.
    Returns audit results and verifies 15/15 detection.
    """
    mutations = build_15_mutations()
    results = []
    caught_count = 0
    misses = []

    print(f"=== RUNNING MUTATION BENCHMARK (15 KNOWN INJECTED VIOLATIONS) ===")

    for m in mutations:
        evaluator = AssertionEvaluator(m["transcript"])
        all_evals = evaluator.evaluate_all()
        target_a = m["expected_assertion"]
        eval_result = all_evals.get(target_a, {})

        # The mutation is successfully caught if the target assertion evaluated to False
        is_caught = (eval_result.get("pass") is False)

        if is_caught:
            caught_count += 1
            status_str = f"PASSED (Caught by {target_a})"
        else:
            status_str = f"MISSED (Judge failed to flag {target_a})"
            misses.append({
                "id": m["id"],
                "description": m["description"],
                "expected_assertion": target_a,
                "assertion_output": eval_result,
            })

        print(f"[{m['id']}] {m['description']}: {status_str}")
        results.append({
            "id": m["id"],
            "description": m["description"],
            "target_assertion": target_a,
            "caught": is_caught,
            "details": eval_result.get("reason") or str(eval_result.get("violations", []))
        })

    summary = {
        "total_mutations": len(mutations),
        "caught": caught_count,
        "missed": len(misses),
        "score_str": f"{caught_count}/{len(mutations)}",
        "perfect": (caught_count == len(mutations)),
        "results": results,
        "misses": misses,
    }

    print(f"\nMutation Judge Score: {summary['score_str']} ({'100% SUCCESS' if summary['perfect'] else 'FAILURES DETECTED'})")
    return summary

if __name__ == "__main__":
    run_mutation_tests()
