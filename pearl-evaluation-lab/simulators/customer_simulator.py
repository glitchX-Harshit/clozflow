"""
Customer Simulator.
Orchestrates multi-turn automated conversations between a simulated prospect and Pearl.
"""
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime

from adapters.base import BasePearlAdapter, AgentConfig, RunRecord
from datasets.schema import EvaluationScenario
from .persona_engine import PersonaEngine
from .dialogue_engine import DialogueEngine


class CustomerSimulator:
    """
    Executes automated dynamic prospect simulation sessions against Pearl adapters.
    """

    def __init__(self, seed: Optional[int] = 42):
        self.dialogue_engine = DialogueEngine(seed=seed)

    async def run_simulation(
        self,
        adapter: BasePearlAdapter,
        scenario: EvaluationScenario,
        max_turns: int = 5
    ) -> RunRecord:
        """
        Executes a multi-turn simulation for a single scenario.
        """
        persona_dict = scenario.prospect_persona.dict()
        persona_engine = PersonaEngine(persona_dict)

        # Build agent config from business context
        agent_config = AgentConfig(
            objective=f"Engage prospect {scenario.prospect_persona.name} regarding {scenario.business_context.product_name}",
            business_name=scenario.business_context.company_name,
            product_name=scenario.business_context.product_name,
            capsule_context=scenario.business_context.capsule_snippet,
            language=scenario.prospect_persona.preferred_language
        )

        # Initialize session
        session_id = await adapter.start_session(agent_config, scenario.scenario_id)

        predefined_turns = [t.dict() for t in scenario.conversation_turns]
        last_pearl_reply: Optional[str] = None

        initial_intent = persona_engine.state.buying_intent

        for turn_idx in range(max_turns):
            # Check termination
            should_stop, reason = persona_engine.should_terminate(max_turns=max_turns)
            if should_stop:
                break

            # 1. Generate prospect utterance
            user_utterance = self.dialogue_engine.generate_next_utterance(
                engine=persona_engine,
                pearl_last_message=last_pearl_reply,
                predefined_turns=predefined_turns
            )

            # 2. Send to Pearl
            pearl_turn = await adapter.send_message(session_id, user_utterance)
            last_pearl_reply = pearl_turn.text

            # 3. Update persona psychological state
            persona_engine.update_state(pearl_turn.text)

        # Finalize run
        run_record = await adapter.end_session(session_id)

        # Attach simulation metadata
        final_intent = persona_engine.state.buying_intent
        run_record.metadata["simulation"] = {
            "initial_buying_intent": initial_intent,
            "final_buying_intent": final_intent,
            "intent_delta": round(final_intent - initial_intent, 3),
            "patience_remaining": round(persona_engine.state.patience, 3),
            "meeting_agreed": persona_engine.state.meeting_agreed,
            "hung_up": persona_engine.state.hung_up,
            "termination_reason": persona_engine.state.termination_reason or "completed",
            "objections_raised": persona_engine.state.objections_raised
        }

        return run_record
