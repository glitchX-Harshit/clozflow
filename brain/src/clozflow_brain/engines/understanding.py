"""Understanding Engine implementation (CCBS-ENGINE-02)."""

from __future__ import annotations

import logging
import math
from time import perf_counter
from typing import List, Dict
from uuid import UUID

from pydantic import BaseModel, Field

from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import EventType
from clozflow_brain.contracts.world_model import ConversationPhase, WorldModelMutation, WorldModelMutationType
from clozflow_brain.infrastructure.llm import get_llm_client

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic Schemas for LLM Extraction
# ---------------------------------------------------------------------------

class BuyerSemantics(BaseModel):
    primary_intent: str = Field(
        description="The primary intent of the speaker, e.g. PRICE_PROBING, INFORMATION_SEEKING, OBJECTION_RAISING, COMMITMENT"
    )
    intent_confidence: float = Field(ge=0.0, le=1.0, description="Confidence in intent extraction")
    topics: List[str] = Field(description="List of core topics mentioned")
    sentiment: str = Field(
        description="One of: VERY_POSITIVE, POSITIVE, NEUTRAL, SKEPTICAL, NEGATIVE, HOSTILE"
    )
    urgency_level: str = Field(description="One of: HIGH, MEDIUM, LOW")
    key_concern: str = Field(
        description="Specific, actionable concern blocking the deal. If none, say 'None'."
    )
    concern_confidence: float = Field(ge=0.0, le=1.0, description="Confidence in key concern extraction")
    confidence: float = Field(ge=0.0, le=1.0, description="Overall confidence in this semantic extraction")


# ---------------------------------------------------------------------------
# Internal Managers
# ---------------------------------------------------------------------------

class ContextAssemblyManager:
    """Assembles context for the LLM while adhering to budget."""
    
    def __init__(self, max_turns: int = 8):
        self.max_turns = max_turns

    def build_prompt(self, context_window: List[str], current_phase: ConversationPhase) -> str:
        # Take the most recent turns up to max_turns
        recent_context = context_window[-self.max_turns:]
        context_str = "\n".join(recent_context)
        return f"Current Phase: {current_phase.value}\n\nConversation Context:\n{context_str}"


class SemanticConsistencyManager:
    """Applies temporal smoothing (EWMA) to sentiments to prevent erratic jumps."""

    SENTIMENT_SCORES = {
        "HOSTILE": -1.0,
        "NEGATIVE": -0.5,
        "SKEPTICAL": -0.2,
        "NEUTRAL": 0.0,
        "POSITIVE": 0.5,
        "VERY_POSITIVE": 1.0,
    }
    
    def __init__(self, alpha: float = 0.3):
        self.alpha = alpha
        self._smoothed_scores: Dict[UUID, float] = {}

    def smooth_sentiment(self, session_id: UUID, raw_sentiment: str) -> str:
        raw_sentiment = raw_sentiment.upper()
        if raw_sentiment not in self.SENTIMENT_SCORES:
            raw_sentiment = "NEUTRAL"
            
        raw_score = self.SENTIMENT_SCORES[raw_sentiment]
        
        if session_id not in self._smoothed_scores:
            self._smoothed_scores[session_id] = raw_score
            return raw_sentiment
            
        # EWMA
        previous_smoothed = self._smoothed_scores[session_id]
        new_smoothed = (self.alpha * raw_score) + ((1 - self.alpha) * previous_smoothed)
        self._smoothed_scores[session_id] = new_smoothed
        
        # Snap back to category
        return self._closest_sentiment(new_smoothed)

    def _closest_sentiment(self, score: float) -> str:
        closest = min(self.SENTIMENT_SCORES.keys(), key=lambda k: abs(self.SENTIMENT_SCORES[k] - score))
        return closest


class PhaseTransitionDetector:
    """Evaluates semantics against rules to detect phase transitions."""
    
    # Simple rule set for transitions based on intent
    TRANSITION_RULES = {
        (ConversationPhase.OPENING, "INFORMATION_SEEKING"): ConversationPhase.DISCOVERY,
        (ConversationPhase.DISCOVERY, "DEMONSTRATION"): ConversationPhase.DEMO,
        (ConversationPhase.DISCOVERY, "PRICE_PROBING"): ConversationPhase.NEGOTIATION,
        (ConversationPhase.DEMO, "PRICE_PROBING"): ConversationPhase.NEGOTIATION,
        (ConversationPhase.NEGOTIATION, "COMMITMENT"): ConversationPhase.CLOSING,
    }

    def detect_transition(
        self, current_phase: ConversationPhase, semantics: BuyerSemantics
    ) -> ConversationPhase | None:
        intent = semantics.primary_intent.upper()
        
        # Check against basic rules
        suggested_phase = self.TRANSITION_RULES.get((current_phase, intent))
        
        # Special case: Objections can happen anywhere
        if intent == "OBJECTION_RAISING" and current_phase not in [ConversationPhase.OBJECTION, ConversationPhase.CLOSING]:
            return ConversationPhase.OBJECTION
            
        return suggested_phase


class ConfidenceCalibrator:
    """Adjusts raw LLM confidence using logistic correction."""
    
    @staticmethod
    def calibrate(raw_confidence: float, context_length: int) -> float:
        # sigmoid(2.5 * raw - 1.5)
        calibrated = 1.0 / (1.0 + math.exp(-(2.5 * raw_confidence - 1.5)))
        
        # Context boost (up to 1.05x for long contexts)
        boost = min(1.05, 1.0 + (context_length * 0.005))
        
        final = min(1.0, max(0.0, calibrated * boost))
        return round(final, 2)


# ---------------------------------------------------------------------------
# Engine Implementation
# ---------------------------------------------------------------------------

class UnderstandingEngine:
    """
    Transforms raw observations into structured semantic meaning (CCBS-ENGINE-02).
    """

    def __init__(self) -> None:
        self._registration = EngineRegistration(
            engine_id="understanding.concrete",
            engine_type=EngineType.UNDERSTANDING,
            version="0.1.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=120,
            priority=1,
            capabilities=["understanding"],
        )
        
        self.context_assembler = ContextAssemblyManager()
        self.consistency_manager = SemanticConsistencyManager()
        self.phase_detector = PhaseTransitionDetector()
        self.confidence_calibrator = ConfidenceCalibrator()
        
        # We fetch the client by our engine ID, so telemetry records correctly
        self.llm_client = get_llm_client("understanding.concrete")
        
        self.system_prompt = (
            "You are the Understanding Engine of ClozFlow Cognitive Brain. "
            "Your task is to extract highly precise semantics (intent, sentiment, topics, urgency, key concerns) "
            "from the provided conversation context."
        )

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        mutations: list[WorldModelMutation] = []
        
        session_id = request.world_model.session_id
        tenant_id = request.world_model.tenant_id
        context_window = request.world_model.context_window
        current_phase = request.world_model.conversation_state.phase

        # If there's no context or events, there's nothing to understand
        if not request.events or not context_window:
            return EngineExecutionOutput(
                engine_id=self.registration.engine_id,
                cycle_id=request.cycle_id,
                status=EngineStatus.SUCCESS,
                confidence=1.0,
                reasoning_trace="No context available for semantic extraction.",
                duration_ms=int((perf_counter() - started) * 1000),
            )

        # Stage 1 & 2: Context Assembly and Prompt Construction
        prompt = self.context_assembler.build_prompt(context_window, current_phase)
        
        try:
            # Stage 3 & 4: LLM Extraction & Schema Validation
            semantics = self.llm_client.generate_structured_output(
                prompt=prompt,
                response_schema=BuyerSemantics,
                system_prompt=self.system_prompt,
                temperature=0.1
            )
            
            # Stage 5: Semantic Post-Processing
            smoothed_sentiment = self.consistency_manager.smooth_sentiment(
                session_id, semantics.sentiment
            )
            
            # Stage 6: Phase Transition Detection
            new_phase = self.phase_detector.detect_transition(current_phase, semantics)
            
            # Stage 8: Confidence Calibration
            context_len = len(context_window)
            calibrated_intent_conf = self.confidence_calibrator.calibrate(semantics.intent_confidence, context_len)
            calibrated_concern_conf = self.confidence_calibrator.calibrate(semantics.concern_confidence, context_len)
            calibrated_overall_conf = self.confidence_calibrator.calibrate(semantics.confidence, context_len)
            
            # Stage 9: Belief Mutation Building
            mutations.append(
                WorldModelMutation(
                    mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                    session_id=session_id,
                    tenant_id=tenant_id,
                    payload={
                        "belief_type": "BUYER_INTENT",
                        "subject": "buyer",
                        "value": semantics.primary_intent,
                        "confidence": calibrated_intent_conf
                    }
                )
            )
            
            mutations.append(
                WorldModelMutation(
                    mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                    session_id=session_id,
                    tenant_id=tenant_id,
                    payload={
                        "belief_type": "BUYER_SENTIMENT",
                        "subject": "buyer",
                        "value": smoothed_sentiment,
                        "confidence": calibrated_overall_conf
                    }
                )
            )
            
            if semantics.key_concern.lower() not in ["none", "n/a", ""]:
                mutations.append(
                    WorldModelMutation(
                        mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                        session_id=session_id,
                        tenant_id=tenant_id,
                        payload={
                            "belief_type": "BUYER_KEY_CONCERN",
                            "subject": "deal",
                            "value": semantics.key_concern,
                            "confidence": calibrated_concern_conf
                        }
                    )
                )
                
            if new_phase:
                mutations.append(
                    WorldModelMutation(
                        mutation_type=WorldModelMutationType.UPDATE_PHASE,
                        session_id=session_id,
                        tenant_id=tenant_id,
                        payload={"phase": new_phase.value}
                    )
                )
                
            trace = (
                f"Intent: {semantics.primary_intent}. "
                f"Sentiment: {smoothed_sentiment}. "
                f"Topics: {', '.join(semantics.topics)}. "
                f"Phase transition: {new_phase.value if new_phase else 'None'}."
            )
            status = EngineStatus.SUCCESS
            final_confidence = calibrated_overall_conf

        except Exception as e:
            logger.error("Understanding Engine LLM extraction failed: %s", e)
            status = EngineStatus.ERROR
            trace = f"Extraction failed: {str(e)}"
            final_confidence = 0.0

        duration_ms = int((perf_counter() - started) * 1000)
        
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=mutations,
            confidence=final_confidence,
            reasoning_trace=trace,
            duration_ms=duration_ms,
            status=status,
        )
