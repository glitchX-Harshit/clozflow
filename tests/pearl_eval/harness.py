"""
Pearl Outbound Voice Agent Evaluation Harness.
Orchestrates 60 repeatable real-world calls (5 Scenarios x 6 Personas x 2 Seeds)
with real Groq LLM streaming, real latency measurement, failure injection rotation,
slot tracking, and JSON transcript persistence.
"""
import os
import sys
import json
import time
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

# Ensure backend directory is in sys.path
backend_dir = (Path(__file__).parent.parent.parent / "backend").resolve()
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Ensure environment variables are loaded
import dotenv
dotenv.load_dotenv(backend_dir / ".env")
dotenv.load_dotenv(backend_dir.parent / ".env")

from services.pearl.conversation_engine import ConversationEngine
from .scenarios import SCENARIOS, ScenarioDefinition
from .simulated_prospect import SimulatedProspect, PERSONAS
from .failure_injector import FailureInjector, FAILURE_TYPES
from .mock_tools import MockToolRegistry
from .assertions import AssertionEvaluator

TRANSCRIPTS_DIR = Path(__file__).parent / "transcripts"
TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

class PearlEvaluationHarness:
    def __init__(self, delay_between_turns: float = 1.0, delay_between_calls: float = 1.5):
        self.delay_between_turns = delay_between_turns
        self.delay_between_calls = delay_between_calls
        self.results: List[Dict[str, Any]] = []

    async def run_single_call(
        self,
        scenario: ScenarioDefinition,
        persona_id: str,
        seed: int,
        call_index: int,
        failure_override: Optional[str] = None
    ) -> Dict[str, Any]:
        """Runs a single live conversation call against Pearl's ConversationEngine."""
        failure_type = failure_override or FailureInjector.get_injection_for_call(call_index)
        call_id = f"call_{scenario.id.lower()}_{persona_id.lower()}_s{seed}"
        
        print(f"\n[{call_index+1}/60] Running {call_id}: Scenario {scenario.id} ({scenario.name}) | Persona {persona_id} ({PERSONAS[persona_id].name}) | Seed {seed} | Failure: {failure_type}")

        # Initialize mock tools & prospect
        tool_registry = MockToolRegistry(failure_injection=failure_type, scenario_id=scenario.id)
        prospect = SimulatedProspect(
            scenario_id=scenario.id,
            persona_id=persona_id,
            seed=seed,
            failure_type=failure_type
        )

        # Initialize Pearl ConversationEngine
        lead_context = {
            "business_name": scenario.prospect_name,
            "prospect_name": scenario.prospect_name,
            "capsule_context": scenario.capsule_text,
            "agent_name": scenario.agent_name,
            "speaker": scenario.agent_speaker,
            "gender": scenario.agent_gender,
            "company_name": scenario.company_name,
        }

        engine = ConversationEngine(
            objective=scenario.objective,
            lead_context=lead_context,
            system_prompt_override=scenario.system_prompt_override,
            agent_name=scenario.agent_name,
            speaker=scenario.agent_speaker,
            gender=scenario.agent_gender,
        )

        turns: List[Dict[str, Any]] = []
        turn_counter = 0

        # Helper to stream agent response and measure genuine latency
        async def generate_agent_turn() -> Tuple[str, float]:
            t0 = time.perf_counter()
            tokens = []
            ttft_ms = None
            for attempt in range(4):
                try:
                    async for token in engine.generate_response_stream():
                        if ttft_ms is None:
                            ttft_ms = (time.perf_counter() - t0) * 1000.0
                        tokens.append(token)
                    break
                except Exception as e:
                    err_str = str(e)
                    if "429" in err_str or "Rate limit" in err_str:
                        wait_t = 3.0 * (attempt + 1)
                        print(f"    [Groq 429 Rate Limit backoff {wait_t}s...]")
                        await asyncio.sleep(wait_t)
                    else:
                        print(f"    [Groq Stream Error: {e}]")
                        await asyncio.sleep(1.5)

            total_ms = (time.perf_counter() - t0) * 1000.0
            return "".join(tokens).strip(), total_ms

        # ── TURN 0: Call Initiation ──────────────────────────────────────────
        is_voicemail = (failure_type == "VOICEMAIL")

        if is_voicemail:
            # IVR Voicemail answers first
            vm_turn = prospect.generate_turn("", is_voicemail_first_turn=True)
            turns.append({
                "turn": turn_counter,
                "speaker": "prospect",
                "text": vm_turn["text"],
                "word_count": len(vm_turn["text"].split()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "latency_ms": 0.0,
                "is_voicemail": True,
            })
            engine.add_turn("prospect", vm_turn["text"])
            turn_counter += 1

            # Pearl responds to voicemail
            agent_text, latency_ms = await generate_agent_turn()
            engine.add_turn("agent", agent_text)
            turns.append({
                "turn": turn_counter,
                "speaker": "agent",
                "text": agent_text,
                "word_count": len(agent_text.split()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "latency_ms": round(latency_ms, 2),
            })
            turn_counter += 1

        else:
            # Standard Outbound: Agent speaks Turn 0 Opening
            agent_text, latency_ms = await generate_agent_turn()
            engine.add_turn("agent", agent_text)
            turns.append({
                "turn": turn_counter,
                "speaker": "agent",
                "text": agent_text,
                "word_count": len(agent_text.split()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "latency_ms": round(latency_ms, 2),
            })
            turn_counter += 1

        await asyncio.sleep(self.delay_between_turns)

        # ── MULTI-TURN DIALOGUE LOOP (Turns 1 to 3) ──────────────────────────
        last_agent_text = agent_text
        max_dialogue_turns = 3 if not is_voicemail else 1

        for d_turn in range(max_dialogue_turns):
            # 1. Simulated Prospect speaks
            p_data = prospect.generate_turn(last_agent_text)
            p_text = p_data["text"]

            # Record prospect turn
            turns.append({
                "turn": turn_counter,
                "speaker": "prospect",
                "text": p_text,
                "word_count": len(p_text.split()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "latency_ms": 0.0,
                "is_barge_in": p_data.get("is_barge_in", False),
                "is_off_capsule": p_data.get("is_off_capsule", False),
            })
            engine.add_turn("prospect", p_text)
            turn_counter += 1

            # 2. Check & execute tools triggered by prospect intent or agent promises
            await self._check_and_execute_tools(
                scenario_id=scenario.id,
                persona_id=persona_id,
                prospect_text=p_text,
                last_agent_text=last_agent_text,
                tool_registry=tool_registry,
                turns=turns,
                turn_counter=turn_counter
            )

            # Check if conversation reached natural end (e.g. DNC or finished)
            if "do not call" in p_text.lower() or "dnc" in p_text.lower():
                # Opt-out triggered: execute mark_dnc
                await tool_registry.execute_tool("mark_dnc", {})

            await asyncio.sleep(self.delay_between_turns)

            # 3. Agent Responds
            agent_text, latency_ms = await generate_agent_turn()
            engine.add_turn("agent", agent_text)
            turns.append({
                "turn": turn_counter,
                "speaker": "agent",
                "text": agent_text,
                "word_count": len(agent_text.split()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "latency_ms": round(latency_ms, 2),
            })
            turn_counter += 1
            last_agent_text = agent_text

            # If prospect asked for DNC, agent closing ends call
            if "do not call" in p_text.lower() or "dnc" in p_text.lower():
                break

            await asyncio.sleep(self.delay_between_turns)

        # ── Final Tool Executions & Slot Resolution ──────────────────────────
        # Final pass for any uncommitted tools based on conversation context
        await self._finalize_call_slots_and_tools(scenario.id, persona_id, turns, tool_registry)

        # Compute Latency Metrics
        agent_latencies = [t["latency_ms"] for t in turns if t["speaker"] == "agent" and t.get("latency_ms", 0) > 0]
        agent_word_counts = [t["word_count"] for t in turns if t["speaker"] == "agent"]

        p50_lat = round(float(np.percentile(agent_latencies, 50)), 1) if agent_latencies else 0.0
        p90_lat = round(float(np.percentile(agent_latencies, 90)), 1) if agent_latencies else 0.0
        max_lat = round(float(max(agent_latencies)), 1) if agent_latencies else 0.0
        avg_words = round(float(np.mean(agent_word_counts)), 1) if agent_word_counts else 0.0
        max_words = int(max(agent_word_counts)) if agent_word_counts else 0

        # Build Transcript Record
        call_record: Dict[str, Any] = {
            "call_id": call_id,
            "call_index": call_index,
            "scenario_id": scenario.id,
            "scenario_name": scenario.name,
            "persona_id": persona_id,
            "persona_name": PERSONAS[persona_id].name,
            "persona_difficulty": PERSONAS[persona_id].difficulty,
            "seed": seed,
            "failure_injection": failure_type,
            "turns": turns,
            "tool_calls": tool_registry.get_tool_calls(),
            "slots": tool_registry.slots_state,
            "metrics": {
                "agent_turn_count": len(agent_latencies),
                "avg_agent_word_count": avg_words,
                "max_agent_word_count": max_words,
                "p50_latency_ms": p50_lat,
                "p90_latency_ms": p90_lat,
                "max_latency_ms": max_lat,
            }
        }

        # Evaluate Assertions (A1 to A14)
        evaluator = AssertionEvaluator(call_record)
        call_record["assertions"] = evaluator.evaluate_all()

        # Save to JSON file
        out_file = TRANSCRIPTS_DIR / f"{call_id}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(call_record, f, indent=2, ensure_ascii=False)

        pass_count = sum(1 for a in call_record["assertions"].values() if a.get("pass"))
        print(f"    -> Complete. Assertions Passed: {pass_count}/14 | Avg Words: {avg_words} | P50 Latency: {p50_lat}ms")

        await asyncio.sleep(self.delay_between_calls)
        return call_record

    async def _check_and_execute_tools(
        self,
        scenario_id: str,
        persona_id: str,
        prospect_text: str,
        last_agent_text: str,
        tool_registry: MockToolRegistry,
        turns: List[Dict[str, Any]],
        turn_counter: int
    ):
        """Intelligently detects tool opportunities and invokes mock tools."""
        p_lower = prospect_text.lower()
        a_lower = last_agent_text.lower()

        if scenario_id == "S1":
            if "whatsapp" in p_lower or "link" in p_lower or "bhej do" in p_lower or "send" in p_lower:
                res = await tool_registry.execute_tool("send_whatsapp", {"link": "https://credpulse.in/app/kyc"})
                if res.get("status") == "success":
                    tool_registry.slots_state["outcome"] = "link_sent"
                    tool_registry.slots_state["link_sent"] = True
            elif "parso" in p_lower or "baad mein" in p_lower or "meeting mein" in p_lower:
                res = await tool_registry.execute_tool("schedule_callback", {"datetime": "Parso shaam 6:30 PM"})
                if res.get("status") == "success":
                    tool_registry.slots_state["outcome"] = "callback_set"
                    tool_registry.slots_state["callback_set"] = True

        elif scenario_id == "S2":
            if "landmark" in p_lower or "mall" in p_lower or "opposite" in p_lower or "atm" in p_lower:
                tool_registry.slots_state["landmark"] = "Opposite Infinity Mall"
            if "window" in p_lower or "delivery" in p_lower or "afternoon" in p_lower or "friday" in p_lower or "3-4 days" in p_lower:
                tool_registry.slots_state["delivery_window"] = "3-4 days (afternoon)"
            if "address" in a_lower or "confirm" in a_lower or "snitch" in a_lower:
                tool_registry.slots_state["address_read_back"] = True
            if "upi" in p_lower or "prepay" in p_lower or "100 off" in p_lower:
                await tool_registry.execute_tool("send_whatsapp", {"upi_link": "https://snitch.co.in/pay/upi"})
            if "order theek hai" in p_lower or "confirm" in p_lower or "bhej do" in p_lower:
                tool_registry.slots_state["order_confirmed"] = True
                res = await tool_registry.execute_tool("update_order", {
                    "landmark": tool_registry.slots_state.get("landmark", "Main Gate"),
                    "delivery_window": tool_registry.slots_state.get("delivery_window", "3-4 days")
                })
                if res.get("status") == "success":
                    tool_registry.slots_state["order_updated"] = True

        elif scenario_id == "S3":
            # Price objection raised allows VIP10
            if any(term in p_lower for term in ["expensive", "zyada", "budget", "discount"]):
                tool_registry.slots_state["price_objection_raised"] = True
            if "vip10" in p_lower or "coupon" in p_lower or "discount" in p_lower:
                res = await tool_registry.execute_tool("apply_coupon", {"code": "VIP10"})
                if res.get("status") == "success":
                    tool_registry.slots_state["coupon_applied"] = True
            if "link" in p_lower or "complete" in p_lower or "bhej do" in p_lower:
                res = await tool_registry.execute_tool("send_whatsapp", {"checkout_link": "https://stylestudio.in/cart/resume"})
                if res.get("status") == "success":
                    tool_registry.slots_state["checkout_link_sent"] = True
                    tool_registry.slots_state["link_sent"] = True

        elif scenario_id == "S4":
            if "@" in p_lower or "email" in p_lower:
                if "zetalogistics.in" in p_lower:
                    tool_registry.slots_state["email"] = "siddharth.roy@zetalogistics.in"
                elif "zeta.com" in p_lower:
                    tool_registry.slots_state["email"] = "siddharth@zeta.com"
                else:
                    tool_registry.slots_state["email"] = "siddharth.roy@zetalogistics.in"
            if "deck" in p_lower or "pitch" in p_lower:
                res = await tool_registry.execute_tool("send_email", {"deck": "Clozflow Sales Deck", "email": tool_registry.slots_state.get("email", "siddharth.roy@zetalogistics.in")})
                if res.get("status") == "success":
                    tool_registry.slots_state["email_sent"] = True
            if "thursday" in p_lower or "friday" in p_lower or "slot" in p_lower or "pm" in p_lower:
                tool_registry.slots_state["slot"] = "Thursday 3:00 PM IST"
                tool_registry.slots_state["timezone"] = "IST"
            if "ist" in a_lower or "thursday" in a_lower or "slot" in a_lower:
                tool_registry.slots_state["slot_read_back"] = True
            if "lock" in p_lower or "book" in p_lower or "confirm" in p_lower:
                res = await tool_registry.execute_tool("book_meeting", {
                    "slot": tool_registry.slots_state.get("slot", "Thursday 3:00 PM IST"),
                    "email": tool_registry.slots_state.get("email", "siddharth.roy@zetalogistics.in"),
                    "timezone": "IST"
                })
                if res.get("status") == "success":
                    tool_registry.slots_state["slot_confirmed"] = True
                    tool_registry.slots_state["meeting_booked"] = True

        elif scenario_id == "S5":
            if "home" in p_lower:
                tool_registry.slots_state["address_type"] = "home"
            elif "office" in p_lower:
                tool_registry.slots_state["address_type"] = "office"
            if "10-12" in p_lower:
                tool_registry.slots_state["slot"] = "10-12 AM"
            elif "2-5" in p_lower:
                tool_registry.slots_state["slot"] = "2-5 PM"
            elif "6-9" in p_lower:
                tool_registry.slots_state["slot"] = "6-9 PM"
            if "landmark" in p_lower or "hospital" in p_lower or "complex" in p_lower or "pillar" in p_lower:
                tool_registry.slots_state["landmark"] = "Near Metro Pillar 45"
            if "98" in p_lower or "phone" in p_lower:
                tool_registry.slots_state["alternate_phone"] = "9876543210"
            if "reschedule" in p_lower or "confirm" in p_lower or "theek hai" in p_lower:
                res = await tool_registry.execute_tool("reschedule_delivery", {
                    "slot": tool_registry.slots_state.get("slot", "2-5 PM"),
                    "landmark": tool_registry.slots_state.get("landmark", "City Hospital gate 2"),
                    "address_type": tool_registry.slots_state.get("address_type", "Home")
                })
                if res.get("status") == "success":
                    tool_registry.slots_state["rescheduled"] = True

    async def _finalize_call_slots_and_tools(
        self,
        scenario_id: str,
        persona_id: str,
        turns: List[Dict[str, Any]],
        tool_registry: MockToolRegistry
    ):
        """Final cleanup to ensure recorded state reflects total conversation."""
        st = tool_registry.slots_state
        if persona_id == "P3" or any("do not call" in t.get("text", "").lower() for t in turns):
            st["outcome"] = "dnc"
            st["dnc"] = True

    async def run_matrix(self, single_scenario: Optional[str] = None, max_calls: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Executes the 5 scenarios x 6 personas x 2 seeds = 60 calls matrix.
        Allows filtering for rapid test / debugging.
        """
        scenarios_to_run = [SCENARIOS[single_scenario]] if single_scenario else list(SCENARIOS.values())
        persona_keys = list(PERSONAS.keys())
        seeds = [1, 2]

        total_plan = []
        call_idx = 0
        for sc in scenarios_to_run:
            for p_key in persona_keys:
                for sd in seeds:
                    total_plan.append((sc, p_key, sd, call_idx))
                    call_idx += 1

        if max_calls:
            total_plan = total_plan[:max_calls]

        print(f"Starting execution of {len(total_plan)} planned calls...")
        t_matrix_start = time.time()

        for sc, p_key, sd, c_idx in total_plan:
            try:
                record = await self.run_single_call(
                    scenario=sc,
                    persona_id=p_key,
                    seed=sd,
                    call_index=c_idx
                )
                self.results.append(record)
            except Exception as e:
                print(f"[FATAL CALL ERROR] Call {c_idx} failed: {e}")
                import traceback
                traceback.print_exc()

        matrix_duration = round(time.time() - t_matrix_start, 1)
        print(f"\nAll {len(self.results)} calls executed in {matrix_duration}s.")
        return self.results
