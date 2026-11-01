"""
Unit Tests for Customer Simulator and Persona Engine.
"""
try:
    import pytest
except ImportError:
    class DummyMark:
        def asyncio(self, f): return f
    class DummyPytest:
        mark = DummyMark()
    pytest = DummyPytest()
from simulators.persona_engine import PersonaEngine
from simulators.dialogue_engine import DialogueEngine
from simulators.customer_simulator import CustomerSimulator
from adapters.mock_adapter import MockPearlAdapter
from datasets.loader import load_scenarios


def test_persona_engine_intent_updates():
    engine = PersonaEngine({
        "name": "Rajesh",
        "role": "Owner",
        "buying_intent": 0.5,
        "patience": 0.8,
        "preferred_language": "Hinglish"
    })

    # Positive Pearl reply
    engine.update_state("Haanji bilkul, main samajh sakti hoon. Hamara demo schedule kar lete hain.")
    assert engine.state.buying_intent > 0.5
    assert engine.state.patience < 0.8
    assert engine.state.turns_completed == 1


@pytest.mark.asyncio
async def test_customer_simulator_end_to_end():
    scenarios = load_scenarios(scenario_id="INB-001")
    assert len(scenarios) == 1
    sc = scenarios[0]

    adapter = MockPearlAdapter()
    sim = CustomerSimulator()
    run = await sim.run_simulation(adapter, sc, max_turns=3)

    assert run.status == "completed"
    assert len(run.turns) >= 2
    assert "simulation" in run.metadata
    assert "intent_delta" in run.metadata["simulation"]
