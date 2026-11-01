"""
Mock Pearl Adapter.
Provides deterministic, zero-dependency offline Pearl simulations for CI/CD and unit testing.
"""
import uuid
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from .base import BasePearlAdapter, AgentConfig, TurnRecord, RunRecord, LatencyMetrics, ToolEvent


class MockPearlAdapter(BasePearlAdapter):
    """
    Simulates Pearl responses deterministically based on keyword triggers,
    objection rules, and scenario context.
    """

    def __init__(self, simulated_latency_ms: float = 350.0):
        super().__init__(name="mock_adapter")
        self.simulated_latency = simulated_latency_ms
        self.sessions: Dict[str, Dict[str, Any]] = {}

    async def is_available(self) -> tuple[bool, str]:
        return True, "Mock adapter is always available offline."

    async def start_session(self, config: AgentConfig, scenario_id: str) -> str:
        session_id = f"mock-sess-{uuid.uuid4().hex[:12]}"
        self.sessions[session_id] = {
            "session_id": session_id,
            "scenario_id": scenario_id,
            "config": config,
            "started_at": datetime.utcnow(),
            "turns": [],
            "turn_count": 0
        }
        return session_id

    async def send_message(self, session_id: str, message: str) -> TurnRecord:
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found.")

        sess = self.sessions[session_id]
        sess["turn_count"] += 1

        # Record prospect turn
        prospect_turn = TurnRecord(
            speaker="prospect",
            text=message,
            timestamp=datetime.utcnow().timestamp()
        )
        sess["turns"].append(prospect_turn)

        t0 = time.monotonic()
        reply_text, tool_events = self._generate_simulated_reply(message, sess["config"], sess["turn_count"])
        elapsed_ms = (time.monotonic() - t0) * 1000 + self.simulated_latency

        pearl_turn = TurnRecord(
            speaker="pearl",
            text=reply_text,
            timestamp=datetime.utcnow().timestamp(),
            latency=LatencyMetrics(ttft_ms=180.0, total_turn_ms=elapsed_ms),
            tool_events=tool_events,
            model_metadata={"provider": "mock_groq", "model": "mock-qwen3.8-27b"}
        )
        sess["turns"].append(pearl_turn)
        return pearl_turn

    async def end_session(self, session_id: str) -> RunRecord:
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found.")

        sess = self.sessions.pop(session_id)
        now = datetime.utcnow()
        duration = (now - sess["started_at"]).total_seconds()

        return RunRecord(
            run_id=f"run-{uuid.uuid4().hex[:8]}",
            scenario_id=sess["scenario_id"],
            adapter_name=self.name,
            session_id=session_id,
            started_at=sess["started_at"],
            completed_at=now,
            turns=sess["turns"],
            total_turns=len(sess["turns"]),
            total_duration_seconds=duration,
            status="completed",
            metadata={"config": sess["config"].dict()}
        )

    def _generate_simulated_reply(
        self,
        message: str,
        config: AgentConfig,
        turn_num: int
    ) -> tuple[str, List[ToolEvent]]:
        lower = message.lower()
        tools: List[ToolEvent] = []

        # 1. Security / Jailbreak / DAN attack defense
        if any(w in lower for w in ["ignore all previous instructions", "system prompt", "dan mode", "developer mode", "pretend you are"]):
            return (
                "Main samajh sakti hoon aap check kar rahe hain, par main yahan specifically aapke business aur sales automation discuss karne ke liye connect hui hoon. Would you like to see how we help with that?",
                []
            )

        # 2. Extreme / Unauthorized Commercial Discount
        if "90%" in lower or "free lifetime" in lower or "free forever" in lower:
            return (
                "Haha, bilkul honest feedback! But standard plans hamare value-backed pricing par chalte hain. Custom commercials leadership team finalize karti hai demo call ke baad.",
                []
            )

        # 3. Objection: Price too high
        if any(w in lower for w in ["too expensive", "mehenga", "price high", "costly", "budget issue", "afford nahi"]):
            return (
                "I completely understand budget concern. Par hamare clients usually 3x ROI 90 days me experience karte hain because operational manual calling cost 70% reduce ho jaati hai. Can we do a quick 10-minute discovery demo?",
                []
            )

        # 4. Objection: Already using competitor
        if any(w in lower for w in ["already using", "competitor", "vendor", "exotel directly", "another platform"]):
            return (
                "Great, that means aap already automated calling ki value samajhte hain! Hum existing tech stack ko replace nahi karte, balki seamlessly complement karte hain with zero disruption. Are you open to a comparative preview?",
                []
            )

        # 5. Objection: Send on WhatsApp / Busy
        if any(w in lower for w in ["whatsapp", "bhej do", "busy right now", "call later", "baad me"]):
            return (
                "Bilkul, main executive summary WhatsApp kar dungi. Just to make sure main relevant information bhejoon, kya aapka primary focus inbound lead qualification hai ya outbound outreach?",
                []
            )

        # 6. Meeting Booking / Agreement
        if any(w in lower for w in ["yes", "interested", "demo", "calendar", "schedule", "tomorrow", "let's connect"]):
            tools.append(ToolEvent(
                tool_name="book_calendar",
                arguments={"date": "tomorrow", "time": "14:00", "summary": f"Demo with {config.business_name}"},
                success=True,
                result={"booking_id": "cal_12345", "status": "confirmed"}
            ))
            return (
                "Perfect! Maine kal 2 baje ka discovery slot lock kar diya hai. Calendar invite and WhatsApp confirmation aapke primary email par share ho gaya hai. Looking forward to our conversation!",
                tools
            )

        # Default in-character opening / turn response
        return (
            f"Haanji, {config.business_name} se Pearl baat kar rahi hoon. Main notice kar rahi thi aapki sales team ke response times, and we help fast-growing teams qualify leads autonomously. How are you currently managing outbound campaigns?",
            []
        )
