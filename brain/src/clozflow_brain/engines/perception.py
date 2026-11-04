"""Perception Engine implementation (CCBS-ENGINE-01)."""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from time import perf_counter
from uuid import UUID, uuid4
from pydantic import BaseModel, Field
from clozflow_brain.infrastructure.llm import get_llm_client

from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import CognitiveEvent, EventType, TranscriptPayload
from clozflow_brain.contracts.world_model import BeliefNode, WorldModelMutation, WorldModelMutationType

logger = logging.getLogger(__name__)



class SpeakerMood(BaseModel):
    """Schema for extracting speaker mood."""
    mood: str = Field(description="The primary mood of the speaker (e.g., happy, frustrated, neutral, angry, confused).")
    intensity: float = Field(description="Intensity of the mood from 0.0 to 1.0.")


class DeduplicationManager:
    """Filters duplicate events using a sliding window LRU cache."""

    def __init__(self, max_size: int = 500) -> None:
        self.max_size = max_size
        self._cache: OrderedDict[str, float] = OrderedDict()

    def is_duplicate(self, event: CognitiveEvent) -> bool:
        """Returns True if the event is a duplicate."""
        payload_str = str(event.payload)[:100]  # Take prefix for hashing speed
        fingerprint_data = f"{event.tenant_id}|{event.session_id}|{event.event_id}|{event.event_type.value}|{event.source}|{payload_str}"
        fingerprint = hashlib.sha256(fingerprint_data.encode("utf-8")).hexdigest()

        if fingerprint in self._cache:
            # Move to end to mark as recently used
            self._cache.move_to_end(fingerprint)
            return True

        self._cache[fingerprint] = perf_counter()
        if len(self._cache) > self.max_size:
            self._cache.popitem(last=False)
        return False


class SequenceManager:
    """Tracks sequence numbers per session to detect gaps and reorders."""

    def __init__(self) -> None:
        self._expected_next: dict[UUID, int] = {}

    def check_sequence(self, session_id: UUID, seq_num: int) -> bool:
        """Returns True if sequence is as expected or newer, False if out of order (older)."""
        expected = self._expected_next.get(session_id, 0)
        if seq_num < expected:
            return False  # Out of order (late arrival)

        # If seq_num > expected, we have a gap, but we accept it and move expected_next forward
        self._expected_next[session_id] = seq_num + 1
        return True


class AnomalyDetector:
    """Detects signal anomalies like fast speech and enforces cooldowns."""

    def __init__(self, speech_rate_threshold: int = 180, cooldown_seconds: float = 30.0) -> None:
        self.speech_rate_threshold = speech_rate_threshold
        self.cooldown_seconds = cooldown_seconds
        self._last_anomaly_times: dict[str, float] = {}  # key: f"{session_id}|{speaker_id}|{anomaly_type}"

    def check_speech_rate(self, session_id: UUID, payload: TranscriptPayload, event_id: UUID) -> BeliefNode | None:
        """Checks if speech rate is anomalous and returns a BeliefNode if cooldown allows."""
        if not payload.audio_features or payload.audio_features.speech_rate_wpm is None:
            return None

        wpm = payload.audio_features.speech_rate_wpm
        if wpm > self.speech_rate_threshold:
            anomaly_key = f"{session_id}|{payload.speaker_id}|FAST_SPEAKING"
            now = perf_counter()
            last_time = self._last_anomaly_times.get(anomaly_key, 0.0)

            if now - last_time > self.cooldown_seconds:
                self._last_anomaly_times[anomaly_key] = now
                return BeliefNode(
                    belief_id=uuid4(),
                    belief_type="SPEAKER_TEMPO",
                    subject=payload.speaker_id,
                    value="FAST_SPEAKING",
                    confidence=0.85,
                    evidence_ids=[event_id],
                )
        return None

    def check_silence(self, session_id: UUID, event_id: UUID) -> BeliefNode:
        """Generates a silence belief."""
        return BeliefNode(
            belief_id=uuid4(),
            belief_type="CONVERSATION_FLOW",
            subject="silence",
            value="SILENCE_DETECTED",
            confidence=0.90,
            evidence_ids=[event_id],
        )


class ConfidenceInitializer:
    """Assigns initial confidence based on signal quality and completeness."""

    @staticmethod
    def calculate_transcript_confidence(payload: TranscriptPayload) -> float:
        """Calculates confidence for a transcript segment."""
        base_confidence = 0.95 if payload.is_final else 0.65

        # Boost slightly if we have audio features (indicates richer signal)
        if payload.audio_features:
            base_confidence = min(0.99, base_confidence + 0.04)

        # Penalize if speaker is unknown
        if payload.speaker_role.value == "UNKNOWN":
            base_confidence *= 0.85

        return round(base_confidence, 2)


class ObservationNormalizer:
    """Standardizes text and metadata before downstream consumption."""

    @staticmethod
    def normalize_transcript(payload: TranscriptPayload) -> str:
        """Normalizes transcript text into a standard context block."""
        # Simple whitespace normalization
        clean_text = " ".join(payload.text.split())
        speaker = payload.speaker_role.value
        return f"{speaker}: {clean_text}"


class PerceptionEngine:
    """
    Transforms raw, unstructured signals into structured, timestamped,
    confidence-scored observations (CCBS-ENGINE-01).
    """

    extract_mood = True

    def __init__(self) -> None:
        self._registration = EngineRegistration(
            engine_id="perception.concrete",
            engine_type=EngineType.PERCEPTION,
            version="0.1.0",
            input_types=[
                EventType.TRANSCRIPT_SEGMENT,
                EventType.SPEAKER_CHANGE,
                EventType.SILENCE_DETECTED,
            ],
            output_types=[],
            latency_budget_ms=100,
            priority=1,
            capabilities=["perception"],
        )

        # Subsystem Managers
        self.dedup_manager = DeduplicationManager()
        self.sequence_manager = SequenceManager()
        self.anomaly_detector = AnomalyDetector()
        self.normalizer = ObservationNormalizer()
        self.confidence_init = ConfidenceInitializer()
        self.llm_client = get_llm_client("perception.concrete")

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        mutations: list[WorldModelMutation] = []

        processed_count = 0
        anomaly_count = 0
        dropped_count = 0
        overall_confidence = 1.0

        session_id = request.world_model.session_id
        tenant_id = request.world_model.tenant_id

        # Sort incoming batch by sequence number to handle micro-batch reordering
        sorted_events = sorted(request.events, key=lambda e: e.sequence_num)

        for event in sorted_events:
            # Stage 1: Ingestion & Deduplication
            if self.dedup_manager.is_duplicate(event):
                dropped_count += 1
                continue

            # Stage 6a: Temporal Sequencing
            if not self.sequence_manager.check_sequence(session_id, event.sequence_num):
                # We could buffer here, but for now we process it with a warning in trace
                pass

            # Stage 2 & 3: Routing & Processing
            if event.event_type == EventType.TRANSCRIPT_SEGMENT:
                try:
                    payload = TranscriptPayload.model_validate(event.payload)

                    # Stage 4: Normalization
                    normalized_text = self.normalizer.normalize_transcript(payload)

                    # Stage 6b: Confidence Initialization
                    conf = self.confidence_init.calculate_transcript_confidence(payload)
                    overall_confidence = min(overall_confidence, conf) # Keep track of lowest confidence in batch

                    # Stage 7a: Mutation Composition (Context)
                    mutations.append(
                        WorldModelMutation(
                            mutation_type=WorldModelMutationType.APPEND_CONTEXT,
                            session_id=session_id,
                            tenant_id=tenant_id,
                            payload={"text": normalized_text},
                            caused_by_event_id=event.event_id,
                        )
                    )
                    processed_count += 1

                    # Rep speech is context for the next buyer turn. It does not
                    # need its own model request or a suggestion to interrupt it.
                    if payload.speaker_role.value == "SALESPERSON" or not self.extract_mood:
                        continue

                    # Stage 7b: Mood Extraction
                    try:
                        mood_prompt = f"Analyze the following transcript segment and determine the speaker's mood: '{normalized_text}'"
                        system_prompt = "You are an expert at analyzing human emotion and mood from short conversational text."
                        speaker_mood = self.llm_client.generate_structured_output(
                            prompt=mood_prompt,
                            response_schema=SpeakerMood,
                            system_prompt=system_prompt,
                            temperature=0.1
                        )
                        mutations.append(
                            WorldModelMutation(
                                mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                                session_id=session_id,
                                tenant_id=tenant_id,
                                payload={
                                    "belief_type": "SPEAKER_MOOD",
                                    "subject": payload.speaker_role.value,
                                    "value": speaker_mood.model_dump(),
                                    "confidence": conf
                                },
                                caused_by_event_id=event.event_id,
                            )
                        )
                    except Exception as llm_err:
                        logger.error("Failed to extract mood via LLM: %s", llm_err)


                    # Stage 5a: Anomaly Detection (Speech Rate)
                    anomaly_belief = self.anomaly_detector.check_speech_rate(session_id, payload, event.event_id)
                    if anomaly_belief:
                        mutations.append(
                            WorldModelMutation(
                                mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                                session_id=session_id,
                                tenant_id=tenant_id,
                                payload=anomaly_belief.model_dump(mode="json"),
                                caused_by_event_id=event.event_id,
                            )
                        )
                        anomaly_count += 1

                except Exception as e:
                    logger.error("Failed to parse transcript segment payload: %s", e)
                    dropped_count += 1

            elif event.event_type == EventType.SILENCE_DETECTED:
                # Stage 5b: Anomaly Detection (Silence)
                belief = self.anomaly_detector.check_silence(session_id, event.event_id)
                mutations.append(
                    WorldModelMutation(
                        mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                        session_id=session_id,
                        tenant_id=tenant_id,
                        payload=belief.model_dump(mode="json"),
                        caused_by_event_id=event.event_id,
                    )
                )
                processed_count += 1
                anomaly_count += 1

        duration_ms = int((perf_counter() - started) * 1000)
        trace = f"Processed {processed_count} perception signals. {anomaly_count} anomalies detected. {dropped_count} events dropped."

        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=mutations,
            confidence=overall_confidence if processed_count > 0 else 1.0,
            reasoning_trace=trace,
            duration_ms=duration_ms,
            status=EngineStatus.SUCCESS,
        )
