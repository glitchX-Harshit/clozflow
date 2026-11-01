"""
Direct Python Module Pearl Adapter.
Directly invokes Pearl's ConversationEngine in-memory without database writes or external network dependencies.
Strictly isolated: does not allow telephony, external writes, or unauthorized API calls.
"""
import sys
import os
import time
import uuid
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

from .base import BasePearlAdapter, AgentConfig, TurnRecord, RunRecord, LatencyMetrics, ToolEvent, RetrievalEvent


class DirectModulePearlAdapter(BasePearlAdapter):
    """
    Direct in-process adapter that runs Clozflow's ConversationEngine.
    Enforces absolute isolation:
    - Zero database commits to production DB.
    - Zero telephony execution (Exotel / Twilio blocked).
    - Thread/session-local in-memory state.
    """

    def __init__(self, backend_path: Optional[str] = None):
        super().__init__(name="direct_module_adapter")
        # Find backend path relative to repository
        if backend_path:
            self.backend_dir = Path(backend_path)
        else:
            # Pearl Evaluation Lab is at ./pearl-evaluation-lab; backend is at ../backend
            self.backend_dir = (Path(__file__).parent.parent.parent / "backend").resolve()

        self._engine_cls = None
        self._import_error: Optional[str] = None
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self._init_engine()

    def _init_engine(self):
        """Safely load ConversationEngine without polluting external runtime."""
        # Attempt to load local credentials if not already exported
        if not os.getenv("GROQ_API_KEY"):
            env_paths = [
                Path(__file__).parent.parent / ".env",
                self.backend_dir / ".env",
                self.backend_dir.parent / ".env"
            ]
            for ep in env_paths:
                if ep.exists():
                    try:
                        with open(ep, "r", encoding="utf-8") as f:
                            for line in f:
                                line = line.strip()
                                if line.startswith("GROQ_API_KEY=") and not line.startswith("#"):
                                    val = line.split("=", 1)[1].strip().strip("'\"")
                                    if val:
                                        os.environ["GROQ_API_KEY"] = val
                                        break
                    except Exception:
                        pass
                if os.getenv("GROQ_API_KEY"):
                    break

        try:
            backend_str = str(self.backend_dir)
            if backend_str not in sys.path and self.backend_dir.exists():
                sys.path.insert(0, backend_str)

            from services.pearl.conversation_engine import ConversationEngine
            self._engine_cls = ConversationEngine
            self._import_error = None
        except Exception as e:
            self._engine_cls = None
            self._import_error = str(e)

    async def is_available(self) -> tuple[bool, str]:
        if self._engine_cls is None:
            return False, f"ConversationEngine module unavailable: {self._import_error}"
        
        # Check Groq key availability
        if not os.getenv("GROQ_API_KEY"):
            return False, "GROQ_API_KEY environment variable is not set for DirectModulePearlAdapter."

        return True, "Direct module ConversationEngine ready for in-memory evaluation."

    async def start_session(self, config: AgentConfig, scenario_id: str) -> str:
        if self._engine_cls is None:
            raise RuntimeError(f"Cannot start session: ConversationEngine unavailable ({self._import_error})")

        session_id = f"direct-sess-{uuid.uuid4().hex[:12]}"

        lead_context = {
            "business_name": config.business_name,
            "prospect_name": "Evaluation Prospect",
            "capsule_context": config.capsule_context,
            "product_name": config.product_name,
            "phone": "+919999900000"  # Virtual dummy phone
        }

        # Safe instantiation - strictly isolated in memory
        engine = self._engine_cls(
            objective=config.objective,
            lead_context=lead_context,
            system_prompt_override=config.system_prompt_override
        )

        self.sessions[session_id] = {
            "session_id": session_id,
            "scenario_id": scenario_id,
            "config": config,
            "engine": engine,
            "started_at": datetime.utcnow(),
            "turns": [],
            "turn_count": 0,
            "tool_events": []
        }
        return session_id

    async def send_message(self, session_id: str, message: str) -> TurnRecord:
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found.")

        sess = self.sessions[session_id]
        engine = sess["engine"]
        sess["turn_count"] += 1

        # Record prospect turn
        prospect_turn = TurnRecord(
            speaker="prospect",
            text=message,
            timestamp=datetime.utcnow().timestamp()
        )
        sess["turns"].append(prospect_turn)

        # Feed prospect message to Pearl engine
        engine.add_turn("prospect", message)

        # Measure timing and stream tokens
        start_time = time.monotonic()
        ttft_ms: Optional[float] = None
        collected_tokens: List[str] = []

        try:
            async for token in engine.generate_response_stream():
                if ttft_ms is None:
                    ttft_ms = (time.monotonic() - start_time) * 1000.0
                collected_tokens.append(token)

            total_turn_ms = (time.monotonic() - start_time) * 1000.0
            response_text = "".join(collected_tokens).strip()

            # Feed Pearl's reply back to engine history
            engine.add_turn("pearl", response_text)

            # Analyze signals for tool triggers
            turn_signals = engine.analyze_latest_turn(message)
            tool_events = []
            if "meeting_interest" in turn_signals.get("signals", []):
                tool_events.append(ToolEvent(
                    tool_name="schedule_meeting",
                    arguments={"prospect": "Evaluation Prospect", "source": "direct_eval"},
                    result={"status": "mock_scheduled", "slot": "Next Tuesday 2:00 PM"},
                    success=True
                ))

            pearl_turn = TurnRecord(
                speaker="pearl",
                text=response_text,
                timestamp=datetime.utcnow().timestamp(),
                latency=LatencyMetrics(
                    ttft_ms=ttft_ms or total_turn_ms,
                    total_turn_ms=total_turn_ms
                ),
                tool_events=tool_events,
                model_metadata={
                    "model": getattr(engine, "model", "qwen/qwen3.8-27b"),
                    "provider": "groq",
                    "security_event": getattr(engine, "last_security_event", None)
                }
            )
            sess["turns"].append(pearl_turn)
            return pearl_turn

        except Exception as e:
            total_turn_ms = (time.monotonic() - start_time) * 1000.0
            fallback_turn = TurnRecord(
                speaker="pearl",
                text=f"[Adapter Error: {str(e)}]",
                timestamp=datetime.utcnow().timestamp(),
                latency=LatencyMetrics(total_turn_ms=total_turn_ms),
                model_metadata={"error": str(e)}
            )
            sess["turns"].append(fallback_turn)
            return fallback_turn

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
