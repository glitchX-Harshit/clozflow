from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from clozflow_brain.api.main import create_app
from clozflow_brain.engines._common import build_context_str


def test_transcript_boundary_final_replay_rep_and_call_context(local_env):
    with TestClient(create_app()) as client:
        tenant = str(uuid4())
        session = client.post("/v1/sessions", json={"tenant_id": tenant, "salesperson_id": "rep",
            "metadata": {"call_context": {"product_name": "Test Product", "product_price": "1000 INR"}}}).json()
        sid = session["session_id"]
        event = {"text": "We need to understand the implementation before approving.", "sequence_num": 1,
                 "event_id": str(uuid4()), "speaker_role": "BUYER", "is_final": False}
        assert client.post(f"/v1/sessions/{sid}/transcripts", json=event).json()["status"] == "awaiting_final"
        event["is_final"] = True
        result = client.post(f"/v1/sessions/{sid}/transcripts", json=event)
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "complete"
        assert len(result.json()["recommendations"]) == 1
        repeated = client.post(f"/v1/sessions/{sid}/transcripts", json=event).json()
        assert repeated["status"] == "duplicate"
        assert repeated["recommendations"] == []
        event.update(event_id=str(uuid4()), sequence_num=2, speaker_role="SALESPERSON")
        rep = client.post(f"/v1/sessions/{sid}/transcripts", json=event).json()
        assert rep["status"] == "recorded"
        assert len(rep["engines"]) == 1
        assert rep["recommendations"] == []
        from clozflow_brain.contracts.context import CognitiveContext
        from clozflow_brain.contracts.world_model import WorldModel
        context = CognitiveContext.model_validate(client.get(f"/v1/sessions/{sid}/context/current").json())
        world = WorldModel.model_validate(client.get(f"/v1/sessions/{sid}/wm").json())
        assert "1000 INR" in build_context_str(world, context)
        client.delete(f"/v1/sessions/{sid}", params={"tenant_id": tenant})
        assert client.post(f"/v1/sessions/{sid}/transcripts", json=event).status_code == 409


@pytest.mark.parametrize("text", ["", "  ", "x" * 16001])
def test_transcript_rejects_invalid_text(local_env, text):
    with TestClient(create_app()) as client:
        sid = client.post("/v1/sessions", json={"tenant_id": str(uuid4()), "salesperson_id": "rep"}).json()["session_id"]
        response = client.post(f"/v1/sessions/{sid}/transcripts", json={"text": text, "sequence_num": 1})
        assert response.status_code == 422
