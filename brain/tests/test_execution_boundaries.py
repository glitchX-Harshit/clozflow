from time import sleep, perf_counter
from uuid import uuid4

from clozflow_brain.contracts.engines import EngineExecutionOutput, EngineRegistration, EngineStatus, EngineType
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import WorldModel, WorldModelMutation, WorldModelMutationType
from clozflow_brain.kernel.registry import EngineRegistry
from clozflow_brain.kernel.scheduler import CognitiveScheduler
from clozflow_brain.kernel.observability import InMemoryTelemetry


def test_late_engine_result_cannot_mutate_state():
    world = WorldModel(session_id=uuid4(), tenant_id=uuid4())
    class SlowEngine:
        registration = EngineRegistration(engine_id="slow", engine_type=EngineType.PERCEPTION,
            version="1", input_types=[EventType.SESSION_START], latency_budget_ms=10, priority=1)
        def execute(self, request):
            sleep(0.15)
            request.world_model.context_window.append("illegal direct write")
            return EngineExecutionOutput(engine_id="slow", cycle_id=request.cycle_id,
                confidence=1, duration_ms=150, status=EngineStatus.SUCCESS,
                wm_mutations=[WorldModelMutation(mutation_type=WorldModelMutationType.APPEND_CONTEXT,
                    session_id=world.session_id, tenant_id=world.tenant_id, payload={"text": "late"})])
    registry = EngineRegistry()
    registry.register(SlowEngine())
    scheduler = CognitiveScheduler(registry, InMemoryTelemetry())
    event = CognitiveEvent.create(event_type=EventType.SESSION_START, session_id=world.session_id,
                                  tenant_id=world.tenant_id, sequence_num=0, source="test", payload={}, confidence=1)
    started = perf_counter()
    result = scheduler.execute(cycle_id=uuid4(), events=[event], world_model=world)
    assert perf_counter() - started < 0.12
    assert result[0].status == EngineStatus.TIMEOUT
    assert result[0].wm_mutations == []
    sleep(0.2)
    assert world.context_window == []
    scheduler.close()


def test_evaluation_preserves_ten_point_scale():
    from clozflow_brain.engines.evaluation import COHScores, EvaluatedStrategy, COHScoringMatrix, HierarchyEnforcer
    strategy = EvaluatedStrategy(strategy_id="good", description="Ask for evidence", intent_target="CLARIFY",
        scores=COHScores(integrity=9, trust=8, success=7, commercial=6, communication=9, efficiency=7))
    validated = COHScoringMatrix().validate(strategy)
    assert validated.scores.integrity == 9
    assert HierarchyEnforcer().enforce([validated]) == [validated]


def test_unverified_recommendation_never_calls_model():
    from unittest.mock import Mock
    from clozflow_brain.engines.recommendation import RecommendationEngine
    from clozflow_brain.contracts.engines import EngineExecutionInput
    world = WorldModel(session_id=uuid4(), tenant_id=uuid4())
    event = CognitiveEvent.create(event_type=EventType.SESSION_START, session_id=world.session_id,
                                  tenant_id=world.tenant_id, sequence_num=0, source="test", payload={}, confidence=1)
    engine = RecommendationEngine()
    engine.llm_client = Mock()
    output = engine.execute(EngineExecutionInput(cycle_id=uuid4(), events=[event], world_model=world, timeout_ms=100))
    assert output.status == EngineStatus.PARTIAL
    assert output.wm_mutations == []
    engine.llm_client.generate_structured_output.assert_not_called()
