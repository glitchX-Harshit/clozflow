"""Prediction Engine implementation (CCBS-ENGINE-04)."""

from __future__ import annotations

import logging
from time import perf_counter
from typing import Dict, Optional

from pydantic import BaseModel, Field

from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import EventType
from clozflow_brain.contracts.world_model import (
    BeliefNode,
    ConversationPhase,
    WorldModel,
    WorldModelMutation,
    WorldModelMutationType,
)
from clozflow_brain.engines._common import build_context_str, deterministic_uuid, empty_events_output
from clozflow_brain.infrastructure.llm import get_llm_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic Schemas for LLM Extraction
# ---------------------------------------------------------------------------

class ForecastAnalysis(BaseModel):
    next_buyer_action: str = Field(
        description="Concrete prediction of the buyer's next action (e.g., ASKS_FOR_PRICING, REQUESTS_DEMO, ENDS_CALL)."
    )
    predicted_objection: str = Field(
        description="The specific objection the buyer is most likely to raise next, or 'NONE' if none expected."
    )
    sentiment_trajectory: str = Field(
        description="Predicted emotional trend: IMPROVING, STABLE, DEGRADING"
    )
    progression_probability: float = Field(
        ge=0.0, le=1.0, description="Probability (0-1) that the deal moves to the next phase."
    )
    biggest_risk: str = Field(
        description="The single biggest hidden risk that could kill the deal right now."
    )
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence in this overall forecast.")
    horizon: str = Field(description="Temporal horizon of the prediction: IMMEDIATE (next turn), NEAR_TERM (next 5 turns), SESSION (by end of meeting).")


# ---------------------------------------------------------------------------
# Internal Managers
# ---------------------------------------------------------------------------

class TrajectoryState(BaseModel):
    sentiment_velocity: str  # IMPROVING, STABLE, DEGRADING
    objection_density: int
    phase: ConversationPhase


class StateExtractor:
    """Aggregates current state and momentum into a TrajectoryState."""
    
    def extract(self, world_model: WorldModel) -> TrajectoryState:
        objection_density = len(world_model.active_objections)
        
        # In a real setup, we would analyze the history of the BUYER_SENTIMENT belief.
        # For this implementation, we approximate from the current belief.
        sentiment_velocity = "STABLE"
        sentiment_belief = next((b for b in world_model.crm_beliefs if b.belief_type == "BUYER_SENTIMENT"), None)
        
        if sentiment_belief:
            val = str(sentiment_belief.value).upper()
            if val in ["POSITIVE", "VERY_POSITIVE"]:
                sentiment_velocity = "IMPROVING"
            elif val in ["NEGATIVE", "HOSTILE", "SKEPTICAL"]:
                sentiment_velocity = "DEGRADING"
                
        return TrajectoryState(
            sentiment_velocity=sentiment_velocity,
            objection_density=objection_density,
            phase=world_model.conversation_state.phase
        )


class HeuristicPredictor:
    """Fast, deterministic rule engine for obvious predictions."""
    
    def predict(self, state: TrajectoryState) -> Optional[Dict]:
        # Rule 1: High objection density in late phases is highly risky
        if state.phase in [ConversationPhase.NEGOTIATION, ConversationPhase.CLOSING] and state.objection_density >= 2:
            return {
                "progression_probability": 0.2,
                "biggest_risk": "Accumulated unaddressed objections late in deal cycle",
                "confidence": 0.85
            }
            
        # Rule 2: Strong momentum in discovery
        if state.phase == ConversationPhase.DISCOVERY and state.sentiment_velocity == "IMPROVING" and state.objection_density == 0:
            return {
                "progression_probability": 0.8,
                "confidence": 0.80
            }
            
        return None


class PredictionSynthesizer:
    """Merges heuristic outputs with LLM forecasts."""
    
    def synthesize(self, heuristic_output: Optional[Dict], llm_output: ForecastAnalysis) -> ForecastAnalysis:
        if not heuristic_output:
            return llm_output
            
        # Heuristics override LLM for specific fields if confidence is higher
        if heuristic_output.get("confidence", 0.0) > llm_output.confidence:
            if "progression_probability" in heuristic_output:
                llm_output.progression_probability = heuristic_output["progression_probability"]
            if "biggest_risk" in heuristic_output:
                llm_output.biggest_risk = heuristic_output["biggest_risk"]
                
        return llm_output


class ProbabilityCalibrator:
    """Adjusts raw probabilities to prevent overconfidence."""
    
    def calibrate(self, forecast: ForecastAnalysis) -> ForecastAnalysis:
        # Penalize confidence slightly based on horizon length
        # (It's harder to predict the SESSION than the IMMEDIATE next turn)
        if forecast.horizon == "SESSION":
            forecast.confidence = round(forecast.confidence * 0.85, 2)
        elif forecast.horizon == "NEAR_TERM":
            forecast.confidence = round(forecast.confidence * 0.95, 2)
            
        forecast.confidence = max(0.0, min(1.0, forecast.confidence))
        forecast.progression_probability = max(0.0, min(1.0, forecast.progression_probability))
        return forecast


# ---------------------------------------------------------------------------
# Engine Implementation
# ---------------------------------------------------------------------------

class PredictionEngine:
    """
    Probabilistic forecasting subsystem (CCBS-ENGINE-04).
    """

    def __init__(self) -> None:
        self._engine_id = "prediction.concrete"
        self._registration = EngineRegistration(
            engine_id=self._engine_id,
            engine_type=EngineType.PREDICTION,
            version="1.0.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=500,
            priority=3,
            capabilities=["prediction"],
        )
        
        self.state_extractor = StateExtractor()
        self.heuristic_predictor = HeuristicPredictor()
        self.synthesizer = PredictionSynthesizer()
        self.calibrator = ProbabilityCalibrator()
        
        self.llm_client = get_llm_client(self._engine_id)
        
        self.system_prompt = (
            "You are the Prediction Engine of ClozFlow Cognitive Brain. "
            "Forecast the likely trajectory of this conversation based on recent transcript events, "
            "active objections, and sentiment momentum. Be realistic and avoid overconfidence."
        )

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        mutations: list[WorldModelMutation] = []
        
        if not request.events:
            return empty_events_output(self._engine_id, request.cycle_id, 0)
            
        world_model = request.world_model

        # Stage 1: State Extraction & Trajectory Modeling
        trajectory = self.state_extractor.extract(world_model)
        
        # Stage 2: Heuristic Prediction
        heuristic_forecast = self.heuristic_predictor.predict(trajectory)
        
        # Build Prompt for LLM
        context_str = build_context_str(world_model, request.cognitive_context, window_size=12)
        objections_str = ", ".join(
            f"{o.objection_type}: '{o.summary}'" for o in world_model.active_objections
        ) or "None"
        
        prompt = (
            f"Phase: {trajectory.phase.value}\n"
            f"Sentiment Velocity: {trajectory.sentiment_velocity}\n"
            f"Active Objections: {objections_str}\n\n"
            f"Conversation History:\n{context_str}"
        )
        
        try:
            # Stage 3: LLM Forecasting
            llm_forecast = self.llm_client.generate_structured_output(
                prompt=prompt,
                response_schema=ForecastAnalysis,
                system_prompt=self.system_prompt,
                temperature=0.1
            )
            
            # Stage 4: Synthesis
            synthesized = self.synthesizer.synthesize(heuristic_forecast, llm_forecast)
            
            # Stage 5: Calibration & Horizon Tracking
            final_forecast = self.calibrator.calibrate(synthesized)
            
            # Stage 6: Mutation Generation (UPSERT_BELIEF as workaround)
            evidence_ids = [event.event_id for event in request.events]
            
            deal_belief = BeliefNode(
                belief_id=deterministic_uuid(request.cycle_id, self._engine_id, "deal_prediction"),
                belief_type="DEAL_PREDICTION",
                subject="deal",
                value={
                    "next_buyer_action": final_forecast.next_buyer_action,
                    "predicted_objection": final_forecast.predicted_objection,
                    "sentiment_trajectory": final_forecast.sentiment_trajectory,
                    "progression_probability": final_forecast.progression_probability,
                    "biggest_risk": final_forecast.biggest_risk,
                    "horizon": final_forecast.horizon
                },
                confidence=final_forecast.confidence,
                evidence_ids=evidence_ids,
                is_explicit=True,
            )
            
            mutations.append(WorldModelMutation(
                mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                session_id=world_model.session_id,
                tenant_id=world_model.tenant_id,
                payload=deal_belief.model_dump(mode="json"),
            ))
            
            trace = (
                f"Predicted next action: {final_forecast.next_buyer_action}. "
                f"Trajectory: {final_forecast.sentiment_trajectory}. "
                f"Progression Prob: {final_forecast.progression_probability:.0%}. "
                f"Biggest Risk: '{final_forecast.biggest_risk}'. (Horizon: {final_forecast.horizon})"
            )
            status = EngineStatus.SUCCESS
            final_conf = final_forecast.confidence
            
        except Exception as e:
            logger.error("Prediction Engine forecasting failed: %s", e)
            status = EngineStatus.ERROR
            trace = f"Forecasting failed: {str(e)}"
            final_conf = 0.0

        duration_ms = int((perf_counter() - started) * 1000)
        
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=mutations,
            confidence=final_conf,
            reasoning_trace=trace,
            duration_ms=duration_ms,
            status=status,
        )
