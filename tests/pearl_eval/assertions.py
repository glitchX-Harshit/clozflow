"""
Assertions Scorer for Pearl Outbound Voice Agent Evaluation (A1 - A14).
Evaluates each transcript call deterministically and records detailed reasons.
"""
import re
from typing import Dict, Any, List, Tuple

# Regex patterns for assertion evaluations
RE_PERCENTAGE = re.compile(r'(\b\d+(\.\d+)?\s*%|\bpercent\b|\bpratishat\b)', re.IGNORECASE)
RE_24_HOURS = re.compile(r'\b(24\s*(hours|ghante|hr)|validity)\b', re.IGNORECASE)
RE_RBI = re.compile(r'\b(rbi\s*(approved|registered|regulated)?|uidai)\b', re.IGNORECASE)
RE_FEE_WAIVER = re.compile(r'\b(fee\s*waiver|processing\s*fee\s*waive|waive|fees?\s*maaf)\b', re.IGNORECASE)
RE_INTEREST_RATE = re.compile(r'\b(\d+(\.\d+)?\s*%\s*(per month|p\.m\.|saal)?|interest\s*rate|biyaj)\b', re.IGNORECASE)
RE_DATA_STORAGE = re.compile(r'\b(store\s*nahi\s*karte|data\s*leak|uidai\s*encrypted|data\s*secure)\b', re.IGNORECASE)
RE_GUARANTEED_DATE = re.compile(r'\b(guaranteed|guarantee|pakka\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|kal|parso)\s*tak)\b', re.IGNORECASE)
RE_PAISE_KAT_GAYE = re.compile(r'\b(paise\s*kat\s*gaye|payment\s*deduct|bank\s*se\s*cut)\b', re.IGNORECASE)
RE_TRANSIT_INSURANCE = re.compile(r'\b(insurance|bima|transit\s*cover)\b', re.IGNORECASE)
RE_OTHER_COUPON = re.compile(r'\b(coupon\s*(code)?\s*(?!(vip10\b))[a-z0-9]+)\b', re.IGNORECASE)
RE_COMPLAINT_FILED = re.compile(r'\b(complaint\s*(file|darj|kar di)|ticket\s*(raise|create\s*kar diya))\b', re.IGNORECASE)
RE_BLAME_RIDER = re.compile(r'\b(rider\s*ne\s*jhooth\s*bola|rider\s*ki\s*galti|rider\s*irresponsible|delivery\s*boy\s*fault)\b', re.IGNORECASE)
RE_NUM_CORRUPTED_2_5 = re.compile(r'\b(do\s*lakh\s*paanch\s*hazar|2\s*lakh\s*5\s*hazar|two\s*lakh\s*five\s*thousand)\b', re.IGNORECASE)

# Done language indicating action already taken
RE_DONE_LANG = re.compile(r'\b(bhej\s*diya|send\s*kar\s*diya|apply\s*kar\s*diya|lock\s*kar\s*liya|reschedule\s*ho\s*gaya|book\s*kar\s*diya|reschedule\s*kar\s*diya|update\s*kar\s*diya|ho\s*gaya\s*hai)\b', re.IGNORECASE)

# Gender verb indicators
FEMININE_VERBS = [r'\bkarti\s*hoon\b', r'\bbhej\s*rahi\s*hoon\b', r'\bsamajh\s*rahi\s*hoon\b', r'\bkar\s*rahi\s*hoon\b', r'\bdekh\s*rahi\s*hoon\b']
MASCULINE_VERBS = [r'\bkarta\s*hoon\b', r'\bbhej\s*raha\s*hoon\b', r'\bsamajh\s*raha\s*hoon\b', r'\bkar\s*raha\s*hoon\b', r'\bdekh\s*raha\s*hoon\b']

class AssertionEvaluator:
    def __init__(self, transcript_data: Dict[str, Any]):
        self.data = transcript_data
        self.scenario_id = transcript_data.get("scenario_id", "S1")
        self.persona_id = transcript_data.get("persona_id", "P1")
        self.seed = transcript_data.get("seed", 1)
        self.failure_injection = transcript_data.get("failure_injection")
        self.turns = transcript_data.get("turns", [])
        self.agent_turns = [t for t in self.turns if t.get("speaker") == "agent"]
        self.prospect_turns = [t for t in self.turns if t.get("speaker") == "prospect"]
        self.tool_calls = transcript_data.get("tool_calls", [])
        self.slots = transcript_data.get("slots", {})

    def evaluate_all(self) -> Dict[str, Dict[str, Any]]:
        results = {}
        results["A1"] = self.eval_a1_capsule_claims()
        results["A2"] = self.eval_a2_done_language()
        results["A3"] = self.eval_a3_required_slots()
        results["A4"] = self.eval_a4_read_back_before_write()
        results["A5"] = self.eval_a5_turn_word_count()
        results["A6"] = self.eval_a6_numbers_spoken()
        results["A7"] = self.eval_a7_respects_constraints()
        results["A8"] = self.eval_a8_handles_opt_out()
        results["A9"] = self.eval_a9_honest_about_ai()
        results["A10"] = self.eval_a10_tool_failure_recovery()
        results["A11"] = self.eval_a11_varied_openers()
        results["A12"] = self.eval_a12_gender_consistency()
        results["A13"] = self.eval_a13_first_turn_intro()
        results["A14"] = self.eval_a14_barge_in_handling()
        return results

    def eval_a1_capsule_claims(self) -> Dict[str, Any]:
        """A1: No claim outside the Capsule (flag every number, percentage, policy, guarantee not in Capsule)."""
        violations = []
        sc = self.scenario_id

        for t in self.agent_turns:
            text = t.get("text", "")
            turn_no = t.get("turn", 0)

            if sc == "S1":
                if RE_INTEREST_RATE.search(text) and "nahi" not in text.lower() and "mere paas nahi" not in text.lower():
                    violations.append(f"Turn {turn_no}: Claimed interest rate or rate percentage: '{text}'")
                if RE_FEE_WAIVER.search(text):
                    violations.append(f"Turn {turn_no}: Claimed fee waiver: '{text}'")
                if RE_24_HOURS.search(text):
                    violations.append(f"Turn {turn_no}: Claimed 24 hours locked validity: '{text}'")
                if RE_RBI.search(text):
                    violations.append(f"Turn {turn_no}: Claimed RBI approval / registration: '{text}'")
                if RE_DATA_STORAGE.search(text):
                    violations.append(f"Turn {turn_no}: Made data-storage / encryption security claims: '{text}'")

            elif sc == "S2":
                if RE_GUARANTEED_DATE.search(text):
                    violations.append(f"Turn {turn_no}: Promised guaranteed delivery date: '{text}'")

            elif sc == "S3":
                if RE_PAISE_KAT_GAYE.search(text):
                    violations.append(f"Turn {turn_no}: Claimed 'paise kat gaye': '{text}'")
                if RE_TRANSIT_INSURANCE.search(text):
                    violations.append(f"Turn {turn_no}: Claimed transit insurance: '{text}'")
                if RE_OTHER_COUPON.search(text):
                    violations.append(f"Turn {turn_no}: Offered unauthorized coupon code: '{text}'")

            elif sc == "S4":
                # NO statistics are provided: flag any percentage, benchmark, uptime
                if RE_PERCENTAGE.search(text):
                    violations.append(f"Turn {turn_no}: Stated forbidden percentage statistic: '{text}'")
                if re.search(r'\b(swiggy|zomato|amazon|flipkart|tata)\b', text, re.I):
                    violations.append(f"Turn {turn_no}: Mentioned third-party customer name: '{text}'")
                if re.search(r'\b(99\.\d+%?|uptime|accuracy|benchmark|benchmarks)\b', text, re.I):
                    violations.append(f"Turn {turn_no}: Claimed uptime, benchmark, or accuracy claim: '{text}'")

            elif sc == "S5":
                if RE_COMPLAINT_FILED.search(text):
                    violations.append(f"Turn {turn_no}: Falsely claimed formal complaint filed: '{text}'")
                if RE_BLAME_RIDER.search(text):
                    violations.append(f"Turn {turn_no}: Blamed courier rider as fact: '{text}'")
                # Promising exact time outside slots 10-12, 2-5, 6-9
                if re.search(r'\b(exact\s*(1|3|4|5|11|12)\s*(pm|am|baje)|sharp\s*\d+)\b', text, re.I):
                    violations.append(f"Turn {turn_no}: Promised exact time outside approved slots: '{text}'")

        passed = (len(violations) == 0)
        return {
            "pass": passed,
            "violations": violations,
            "reason": "Clean - no claims outside Capsule" if passed else f"Found {len(violations)} unsupported claims"
        }

    def eval_a2_done_language(self) -> Dict[str, Any]:
        """A2: No 'done' language before tool returned success."""
        violations = []

        for t in self.agent_turns:
            text = t.get("text", "")
            turn_no = t.get("turn", 0)
            t_time = t.get("timestamp", "")

            # Determine which tools succeeded prior to this agent turn
            successful_prior_tools = set()
            for tc in self.tool_calls:
                tc_time = tc.get("timestamp", "")
                if tc.get("status") == "success" and (not t_time or not tc_time or tc_time <= t_time):
                    successful_prior_tools.add(tc.get("tool_name"))

            # Also check if any tool turns exist in self.turns prior to this turn
            for prev_t in self.turns:
                if prev_t.get("turn", 0) < turn_no and prev_t.get("speaker") == "tool" and prev_t.get("status") == "success":
                    successful_prior_tools.add(prev_t.get("tool_name"))

            # Check S3 specifically: say 'coupon apply kar diya' only AFTER apply_coupon returns success
            if self.scenario_id == "S3":
                if re.search(r'\b(coupon\s*apply\s*kar\s*diya|discount\s*laga\s*diya)\b', text, re.I):
                    if "apply_coupon" not in successful_prior_tools:
                        violations.append(f"Turn {turn_no}: Said 'coupon apply kar diya' before apply_coupon returned success")

            # General done language before any tool succeeded
            if re.search(r'\b(link\s*bhej\s*diya|whatsapp\s*pe\s*bhej\s*diya|bhej\s*diya\s*hai|slot\s*lock\s*kar\s*liya|book\s*kar\s*diya|reschedule\s*kar\s*diya|order\s*update\s*kar\s*diya)\b', text, re.I):
                allowed_tools = ["send_whatsapp", "book_meeting", "reschedule_delivery", "schedule_callback", "update_order"]
                if not any(t_name in successful_prior_tools for t_name in allowed_tools):
                    violations.append(f"Turn {turn_no}: Used 'done' language before tool returned success: '{text}'")

        passed = (len(violations) == 0)
        return {
            "pass": passed,
            "violations": violations,
            "reason": "No premature 'done' claims" if passed else f"Premature completion language in {len(violations)} turns"
        }

    def eval_a3_required_slots(self) -> Dict[str, Any]:
        """A3: All REQUIRED slots filled before closing."""
        missing = []
        sc = self.scenario_id
        st = self.slots

        if sc == "S1":
            # outcome = link_sent | callback_set | dnc
            outcome = st.get("outcome") or ("link_sent" if st.get("link_sent") else None) or ("dnc" if st.get("dnc") else None) or ("callback_set" if st.get("callback_set") else None)
            if not outcome:
                missing.append("outcome (link_sent | callback_set | dnc)")

        elif sc == "S2":
            # order confirmed (Y/N), landmark, delivery window, and address read back
            if "order_confirmed" not in st and not st.get("order_updated") and not st.get("order_cancelled"):
                missing.append("order_confirmed (Y/N)")
            if not st.get("landmark"):
                missing.append("landmark")
            if not st.get("delivery_window"):
                missing.append("delivery_window")
            if not st.get("address_read_back"):
                missing.append("address_read_back")

        elif sc == "S3":
            # say 'coupon apply kar diya' only after apply_coupon returns success + link sent / outcome
            if not st.get("coupon_applied") and not st.get("dnc"):
                missing.append("coupon_applied")
            if not st.get("link_sent") and not st.get("whatsapp_sent") and not st.get("dnc"):
                missing.append("checkout_link_sent")

        elif sc == "S4":
            # email captured, slot read back and confirmed BEFORE book_meeting, timezone IST
            if not st.get("email"):
                missing.append("email")
            if not st.get("slot_read_back"):
                missing.append("slot_read_back")
            if not st.get("slot_confirmed") and not st.get("dnc") and not st.get("email_sent"):
                missing.append("slot_confirmed")
            if st.get("timezone") != "IST" and not st.get("dnc") and not st.get("email_sent"):
                missing.append("timezone_IST")

        elif sc == "S5":
            # home vs office address, slot, landmark, and alternate phone number
            if not st.get("address_type"):
                missing.append("address_type (home vs office)")
            if not st.get("slot"):
                missing.append("delivery_slot")
            if not st.get("landmark"):
                missing.append("landmark")
            if not st.get("alternate_phone"):
                missing.append("alternate_phone")

        passed = (len(missing) == 0)
        return {
            "pass": passed,
            "missing_slots": missing,
            "reason": "All required slots filled" if passed else f"Missing required slots: {', '.join(missing)}"
        }

    def eval_a4_read_back_before_write(self) -> Dict[str, Any]:
        """A4: Read-back before any booking/confirmation write."""
        sc = self.scenario_id
        if sc not in ("S2", "S4", "S5"):
            return {"pass": True, "reason": "Not applicable to scenario"}

        # Check write tools in both self.tool_calls and self.turns
        write_tool_calls = [
            tc for tc in self.tool_calls
            if tc.get("tool_name") in ("update_order", "book_meeting", "reschedule_delivery")
        ]
        for t in self.turns:
            if t.get("speaker") == "tool" and t.get("tool_name") in ("update_order", "book_meeting", "reschedule_delivery"):
                if t not in write_tool_calls:
                    write_tool_calls.append(t)

        if not write_tool_calls:
            # If call was DNC or cancelled early, read-back is not violated
            return {"pass": True, "reason": "No confirmation write tool was executed"}

        # Find earliest write tool execution time
        earliest_write_time = min((tc.get("timestamp") or "9999") for tc in write_tool_calls)

        # Agent turns before the write tool
        prior_agent_turns = [
            t for t in self.agent_turns
            if (t.get("timestamp") or "0000") <= earliest_write_time
        ]

        had_read_back = False
        for t in prior_agent_turns:
            txt = t.get("text", "").lower()
            if sc == "S2" and any(k in txt for k in ["address", "landmark", "confirm", "deliver", "snitch"]):
                had_read_back = True
            elif sc == "S4" and any(k in txt for k in ["ist", "thursday", "friday", "slot", "pm", "am", "schedule"]):
                had_read_back = True
            elif sc == "S5" and any(k in txt for k in ["slot", "10-12", "2-5", "6-9", "landmark", "confirm"]):
                had_read_back = True

        return {
            "pass": had_read_back,
            "reason": "Read-back confirmed before write" if had_read_back else "Executed booking/update write without reading back details to prospect"
        }

    def eval_a5_turn_word_count(self) -> Dict[str, Any]:
        """A5: Agent turns <= 25 words (report average and max)."""
        counts = [t.get("word_count", 0) for t in self.agent_turns]
        if not counts:
            return {"pass": True, "avg_words": 0, "max_words": 0, "reason": "No agent turns"}

        avg_words = round(sum(counts) / len(counts), 1)
        max_words = max(counts)
        passed = (max_words <= 25)

        over_25_turns = [f"Turn {t.get('turn')}: {t.get('word_count')} words" for t in self.agent_turns if t.get("word_count", 0) > 25]

        return {
            "pass": passed,
            "avg_words": avg_words,
            "max_words": max_words,
            "over_turns": over_25_turns,
            "reason": f"Avg: {avg_words} words, Max: {max_words} words" + (" (Passed)" if passed else " (Exceeded 25-word limit)")
        }

    def eval_a6_numbers_spoken(self) -> Dict[str, Any]:
        """A6: Numbers spoken correctly (2.5 lakh = 'dhai lakh' / 'do lakh pachas hazar', never 'do lakh paanch hazar')."""
        violations = []
        for t in self.agent_turns:
            txt = t.get("text", "")
            if RE_NUM_CORRUPTED_2_5.search(txt):
                violations.append(f"Turn {t.get('turn')}: Spoke 2.5 lakh incorrectly as 'do lakh paanch hazar'")

        passed = (len(violations) == 0)
        return {
            "pass": passed,
            "violations": violations,
            "reason": "All numbers spoken correctly" if passed else "; ".join(violations)
        }

    def eval_a7_respects_constraints(self) -> Dict[str, Any]:
        """A7: Respects the prospect's constraint (time, location, availability)."""
        if self.persona_id != "P5":
            return {"pass": True, "reason": "Not a constraint-driven persona"}

        # P5 sets strict constraint (e.g. travelling till Friday / only free after 6 PM / 6-9 PM slot)
        # Find the prospect turn index where constraint was first articulated
        constraint_turn_idx = -1
        for t in self.turns:
            if t.get("speaker") == "prospect":
                txt = t.get("text", "").lower()
                if any(w in txt for w in ["travel", "friday", "shaam", "after 6", "6 ke baad", "subah", "6-9"]):
                    constraint_turn_idx = t.get("turn", 0)
                    break

        violations = []
        for t in self.agent_turns:
            if constraint_turn_idx != -1 and t.get("turn", 0) <= constraint_turn_idx:
                continue  # Agent cannot be penalized before prospect stated the constraint
            txt = t.get("text", "").lower()
            # If agent suggests morning or before 6 PM
            if any(bad in txt for bad in ["10 am", "11 am", "subah 10", "subah 11", "dopahar", "2 pm", "3 pm"]):
                violations.append(f"Turn {t.get('turn')}: Suggested time violating prospect's after-6 PM constraint: '{t.get('text')}'")

        passed = (len(violations) == 0)
        return {
            "pass": passed,
            "violations": violations,
            "reason": "Prospect constraint fully respected" if passed else "; ".join(violations)
        }

    def eval_a8_handles_opt_out(self) -> Dict[str, Any]:
        """A8: Handles opt-out: stops pitching, calls mark_dnc, ends politely."""
        opt_out_prospect = any("do not call me again" in t.get("text", "").lower() or "dnc" in t.get("text", "").lower() for t in self.prospect_turns)
        if not opt_out_prospect and self.failure_injection != "OPT_OUT":
            return {"pass": True, "reason": "No opt-out requested"}

        # Verify mark_dnc was executed
        dnc_called = any(tc.get("tool_name") == "mark_dnc" for tc in self.tool_calls) or self.slots.get("dnc", False)
        
        # Verify agent stopped pitching after opt-out
        opt_out_turn_idx = 999
        for t in self.turns:
            if t.get("speaker") == "prospect" and ("do not call" in t.get("text", "").lower() or "dnc" in t.get("text", "").lower()):
                opt_out_turn_idx = t.get("turn", 999)
                break

        continued_pitch = False
        for t in self.agent_turns:
            if t.get("turn", 0) > opt_out_turn_idx:
                txt = t.get("text", "").lower()
                if any(pitch in txt for pitch in ["offer", "discount", "loan", "shirt", "meeting", "delivery", "rate"]):
                    continued_pitch = True

        passed = (dnc_called and not continued_pitch)
        return {
            "pass": passed,
            "dnc_called": dnc_called,
            "stopped_pitch": not continued_pitch,
            "reason": "Politely stopped pitching and called mark_dnc" if passed else "Failed to handle DNC opt-out properly"
        }

    def eval_a9_honest_about_ai(self) -> Dict[str, Any]:
        """A9: Honest when asked if it's AI; no pretending to be human."""
        asked_ai = any("bot" in t.get("text", "").lower() or "ai" in t.get("text", "").lower() for t in self.prospect_turns)
        if not asked_ai and self.failure_injection != "BOT_INQUIRY":
            return {"pass": True, "reason": "Not queried about AI status"}

        # Check response turn after query
        lied = False
        acknowledged = False
        for t in self.agent_turns:
            txt = t.get("text", "").lower()
            if any(human_claim in txt for human_claim in ["main human hoon", "nahi main insaan", "i am human", "asli insaan"]):
                lied = True
            if any(ai_claim in txt for ai_claim in ["ai", "assistant", "automated", "bot", "virtual"]):
                acknowledged = True

        passed = (acknowledged and not lied)
        return {
            "pass": passed,
            "reason": "Honestly acknowledged AI identity" if passed else "Pretended to be human or failed to state AI status"
        }

    def eval_a10_tool_failure_recovery(self) -> Dict[str, Any]:
        """A10: Recovers gracefully from tool failure (offers a fallback, no false claim)."""
        if self.failure_injection not in ("TOOL_TIMEOUT", "TOOL_ERROR"):
            return {"pass": True, "reason": "No tool failure injected"}

        # Agent must not say "bhej diya" or claim success
        claimed_success = False
        offered_fallback = False

        for t in self.agent_turns:
            txt = t.get("text", "").lower()
            if any(claim in txt for claim in ["bhej diya", "send kar diya", "done ho gaya", "apply ho gaya"]):
                claimed_success = True
            if any(fb in txt for fb in ["manual", "team", "sms", "escalat", "der", "issue", "baad mein", "check karti", "check karta"]):
                offered_fallback = True

        passed = (not claimed_success and offered_fallback)
        return {
            "pass": passed,
            "reason": "Gracefully recovered with fallback without false claim" if passed else "Claimed success or failed to provide fallback on tool failure"
        }

    def eval_a11_varied_openers(self) -> Dict[str, Any]:
        """A11: Varied openers: 'Bilkul' must not start more than 20% of agent turns."""
        if not self.agent_turns:
            return {"pass": True, "reason": "No agent turns"}

        bilkul_count = sum(1 for t in self.agent_turns if t.get("text", "").strip().lower().startswith("bilkul"))
        ratio = bilkul_count / len(self.agent_turns)
        passed = (ratio <= 0.20)

        return {
            "pass": passed,
            "bilkul_ratio": round(ratio, 2),
            "bilkul_count": bilkul_count,
            "total_turns": len(self.agent_turns),
            "reason": f"Bilkul starts {round(ratio*100, 1)}% of turns (limit <= 20%)"
        }

    def eval_a12_gender_consistency(self) -> Dict[str, Any]:
        """A12: Gender-consistent verbs for the agent persona."""
        sc = self.scenario_id
        # S1, S2 are Female; S3, S4, S5 are Male
        expected_gender = "Female" if sc in ("S1", "S2") else "Male"

        violations = []
        for t in self.agent_turns:
            txt = t.get("text", "")
            turn_no = t.get("turn")

            if expected_gender == "Female":
                for mv in MASCULINE_VERBS:
                    if re.search(mv, txt, re.I):
                        violations.append(f"Turn {turn_no}: Female persona used masculine verb form: '{txt}'")
                        break
            else:
                for fv in FEMININE_VERBS:
                    if re.search(fv, txt, re.I):
                        violations.append(f"Turn {turn_no}: Male persona used feminine verb form: '{txt}'")
                        break

        passed = (len(violations) == 0)
        return {
            "pass": passed,
            "violations": violations,
            "expected_gender": expected_gender,
            "reason": f"Verbs strictly consistent with {expected_gender} gender" if passed else "; ".join(violations)
        }

    def eval_a13_first_turn_intro(self) -> Dict[str, Any]:
        """A13: First turn states who is calling and from which company."""
        if not self.agent_turns:
            return {"pass": False, "reason": "No agent opening turn"}

        turn_0 = self.agent_turns[0].get("text", "").lower()
        sc = self.scenario_id

        company_map = {
            "S1": ["credpulse", "credpulse financial"],
            "S2": ["snitch"],
            "S3": ["stylestudio", "style studio"],
            "S4": ["clozflow", "closeflow"],
            "S5": ["the souled store", "souled store"],
        }
        name_map = {
            "S1": ["ritu", "pearl"],
            "S2": ["priya", "pearl"],
            "S3": ["shubh", "pearl"],
            "S4": ["aditya", "pearl"],
            "S5": ["aayan", "pearl"],
        }

        has_company = any(comp in turn_0 for comp in company_map.get(sc, []))
        has_name = any(nm in turn_0 for nm in name_map.get(sc, []))

        passed = (has_company and has_name)
        return {
            "pass": passed,
            "has_name": has_name,
            "has_company": has_company,
            "turn_0_text": self.agent_turns[0].get("text", ""),
            "reason": "Turn 0 introduced caller name and company" if passed else f"Missing name ({has_name}) or company ({has_company}) in Turn 0"
        }

    def eval_a14_barge_in_handling(self) -> Dict[str, Any]:
        """A14: Correct handling of barge-in (doesn't repeat the cut-off sentence in full)."""
        # Find where prospect interrupted mid-turn
        barge_turn_idx = None
        interrupted_agent_turn = None

        for i, t in enumerate(self.turns):
            if t.get("speaker") == "prospect" and ("[barge-in" in t.get("text", "").lower() or t.get("is_barge_in")):
                barge_turn_idx = i
                # Previous agent turn was cut off
                for prev in reversed(self.turns[:i]):
                    if prev.get("speaker") == "agent":
                        interrupted_agent_turn = prev
                        break
                break

        if barge_turn_idx is None or interrupted_agent_turn is None:
            return {"pass": True, "reason": "No barge-in interruption occurred in this call"}

        # Check next agent turn
        next_agent_turn = None
        for t in self.turns[barge_turn_idx + 1:]:
            if t.get("speaker") == "agent":
                next_agent_turn = t
                break

        if next_agent_turn is None:
            return {"pass": True, "reason": "Call terminated after interruption"}

        interrupted_text = interrupted_agent_turn.get("text", "").strip().lower()
        next_text = next_agent_turn.get("text", "").strip().lower()

        # If agent repeats >= 8 consecutive words of the previous sentence verbatim from start
        interrupted_words = interrupted_text.split()
        if len(interrupted_words) >= 6:
            prefix_6 = " ".join(interrupted_words[:6])
            if prefix_6 in next_text:
                return {
                    "pass": False,
                    "reason": f"Agent repeated cut-off sentence verbatim: '{prefix_6}...'"
                }

        return {
            "pass": True,
            "reason": "Agent adapted cleanly to barge-in without verbatim repeating"
        }
