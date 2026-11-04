from uuid import uuid4

from fastapi.testclient import TestClient

from clozflow_brain.api.main import create_app
from clozflow_brain.engines.compact import TurnAnalysis


def analysis(**changes):
    return TurnAnalysis.model_validate({
        "phase": "DISCOVERY", "intent": "pricing question", "strategy": "Answer the price",
        "rationale": "Use the supplied price.", "response": "It costs 1000 INR per month.",
        "confidence": 0.9, "should_respond": True, "objection_type": "none", "objection_quote": "",
        "grounding_quotes": ["1000 INR per month"], **changes,
    })


def test_compact_uses_one_call_and_checks_grounding(local_env, monkeypatch):
    monkeypatch.setenv("CEB_ENGINES_CONFIG", "configs/engines.local.yaml")
    responses = iter([analysis(), analysis(response="It costs 500 INR per month."),
                      analysis(grounding_quotes=["Guaranteed 10x returns"]),
                      analysis(objection_type="price", objection_quote="I cannot afford that"),
                      analysis(confidence=0.4)])
    calls = []

    def generate(self, prompt, response_schema, *args, **kwargs):
        calls.append(response_schema)
        return next(responses)

    monkeypatch.setattr("clozflow_brain.infrastructure.llm_local.LocalLLMClient.generate_structured_output", generate)
    with TestClient(create_app()) as client:
        sid = client.post("/v1/sessions", json={"tenant_id": str(uuid4()), "salesperson_id": "rep",
            "metadata": {"call_context": {"product_price": "1000 INR per month"}}}).json()["session_id"]
        for seq in range(1, 6):
            response = client.post(f"/v1/sessions/{sid}/transcripts", json={
                "text": "What is the price?", "speaker_role": "BUYER", "sequence_num": seq,
            })
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["status"] == ("complete" if seq == 1 else "withheld")
            assert bool(result["recommendations"]) == (seq == 1)
            assert len(calls) == seq
        assert all(schema is TurnAnalysis for schema in calls)
