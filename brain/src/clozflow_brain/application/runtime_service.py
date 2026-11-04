"""Local governance, feedback, workflow and evidence-backed runtime views."""
from __future__ import annotations

import json
import re
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.contracts.memory import MemoryRecord, MemoryScope, MemoryType
from clozflow_brain.contracts.world_model import WorldModelMutationType


class BrainPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_confidence: float = Field(default=0.70, ge=0.50, le=1)
    forbidden_phrases: list[str] = Field(default_factory=list, max_length=50)
    max_response_chars: int = Field(default=1000, ge=80, le=4000)
    require_supported_numbers: bool = True
    cycle_budget_ms: int = Field(default=90000, ge=1000, le=300000)
    max_model_calls: int = Field(default=10, ge=1, le=20)
    retention_days: int = Field(default=0, ge=0, le=3650)
    memory_half_life_days: int = Field(default=90, ge=1, le=3650)


class RuntimeService:
    def __init__(self, store):
        self.store = store

    def policy(self, tenant_id):
        record = self.store.get(tenant_id, "policy", "active")
        return BrainPolicy.model_validate(record["policy"] if record else {})

    def audit(self, tenant_id, action, data, *, session_id=None):
        return self.store.put(tenant_id, "audit", {"action": action, "data": data}, session_id=session_id)

    def update_policy(self, tenant_id, policy, version):
        result = self.store.put(tenant_id, "policy", {"policy": policy.model_dump()},
                                record_id="active", expected_version=version)
        self.audit(tenant_id, "policy.updated", {"version": result["version"], "policy": policy.model_dump()})
        return result

    def gate_recommendations(self, outputs, context, tenant_id):
        policy = self.policy(tenant_id)
        facts = json.dumps([fragment.content for fragment in context.fragments
                            if fragment.source_type.value in {"BUSINESS_STATE", "KNOWLEDGE"}],
                           ensure_ascii=False, default=str) if context else ""
        available_numbers = set(re.findall(r"\d+(?:\.\d+)?", facts.replace(",", "")))
        for output in outputs:
            kept = []
            for mutation in output.wm_mutations:
                if mutation.mutation_type != WorldModelMutationType.PUSH_RECOMMENDATION:
                    kept.append(mutation)
                    continue
                rec = mutation.payload
                body = rec["content"]["body"]
                reasons = []
                if rec["confidence"] < policy.min_confidence:
                    reasons.append("confidence")
                if len(body) > policy.max_response_chars:
                    reasons.append("length")
                if any(phrase.strip() and phrase.casefold() in body.casefold() for phrase in policy.forbidden_phrases):
                    reasons.append("organization policy")
                numbers = set(re.findall(r"\d+(?:\.\d+)?", body.replace(",", "")))
                if policy.require_supported_numbers and not numbers.issubset(available_numbers):
                    reasons.append("unsupported numeric claim")
                if reasons:
                    from clozflow_brain.contracts.engines import EngineStatus
                    output.status = EngineStatus.PARTIAL
                    output.reasoning_trace = "Recommendation withheld: " + ", ".join(reasons)
                else:
                    kept.append(mutation)
            output.wm_mutations = kept

    def record_cycle(self, result, session):
        nodes = []
        previous = None
        for output in result.engine_outputs:
            nodes.append({"id": output.engine_id, "depends_on": [previous] if previous else [],
                          "status": output.status.value, "duration_ms": output.duration_ms,
                          "confidence": output.confidence, "explanation": output.reasoning_trace})
            previous = output.engine_id
        data = {
            "session_id": str(session.session_id), "cycle_id": str(result.cycle_id),
            "objective": session.metadata.get("call_context", {}).get("call_goal", "Understand the turn and provide useful guidance"),
            "event_ids": [str(event.event_id) for event in result.accepted_events],
            "graph": nodes, "world_version": result.world_model.version,
            "recommendations": [rec.model_dump(mode="json") for rec in result.world_model.pending_recommendations
                                if rec.cycle_id == result.cycle_id],
            "errors": result.trace.error_count,
        }
        self.store.put(session.tenant_id, "cycle", data, record_id=str(result.cycle_id), session_id=session.session_id)
        for output in result.engine_outputs:
            for mutation in output.wm_mutations:
                if mutation.payload.get("belief_type") == "SESSION_SUMMARY":
                    for step in mutation.payload.get("value", {}).get("next_steps", []):
                        task_id = str(uuid5(session.session_id, str(step)))
                        if not self.store.get(session.tenant_id, "task", task_id):
                            self.store.put(session.tenant_id, "task", {"title": step, "status": "proposed",
                                "source_cycle_id": str(result.cycle_id), "execution": "local_checklist"},
                                record_id=task_id, session_id=session.session_id)
        self.store.mark([event.event_id for event in result.accepted_events], "complete")

    def recommendation(self, session, rec_id):
        for cycle in self.store.list(session.tenant_id, "cycle", session_id=session.session_id, limit=2000):
            for rec in cycle.get("recommendations", []):
                if rec["rec_id"] == str(rec_id):
                    return rec
        raise KeyError("Recommendation not found in this session")

    def feedback(self, session, rec_id, payload, memory_service):
        rec = self.recommendation(session, rec_id)
        record_id = str(uuid5(session.session_id, str(rec_id)))
        previous = self.store.get(session.tenant_id, "feedback", record_id) or {}
        data = {**previous, **payload, "session_id": str(session.session_id), "recommendation_id": str(rec_id),
                "confidence": rec["confidence"], "strategy": rec["content"]["headline"], "source": "human_feedback"}
        saved = self.store.put(session.tenant_id, "feedback", data, record_id=record_id, session_id=session.session_id)
        self.audit(session.tenant_id, "feedback.recorded", {"id": record_id, "version": saved["version"]}, session_id=session.session_id)
        # Negative feedback is retained too; retrieval can learn what to avoid.
        memory_service.store(MemoryRecord(
            memory_id=UUID(record_id), tenant_id=session.tenant_id, memory_type=MemoryType.PROCEDURAL,
            scope=MemoryScope.TENANT, subject=f"Feedback: {rec['content']['headline']}",
            content=data, concepts=rec["content"]["headline"].lower().split(), confidence=1.0,
            provenance_event_ids=rec["triggered_by"],
        ))
        return saved

    def learning(self, tenant_id):
        records = self.store.list(tenant_id, "feedback", limit=10000)
        rated = [item for item in records if item.get("helpful") is not None]
        used = [item for item in records if item.get("used") is not None]
        positive = sum(bool(item["helpful"]) for item in rated)
        return {"feedback_count": len(records), "rated_count": len(rated),
                "helpfulness_rate": positive / len(rated) if rated else None,
                "adherence_rate": sum(bool(item["used"]) for item in used) / len(used) if used else None,
                "brier_score": sum((item["confidence"] - float(item["helpful"])) ** 2 for item in rated) / len(rated) if rated else None,
                "measurement": "User-reported helpfulness and use; not causal sales performance or model accuracy",
                "model_weights_trained": False}

    def worlds(self, session, world):
        beliefs = {belief.belief_type: {"value": belief.value, "confidence": belief.confidence,
                   "evidence_ids": [str(eid) for eid in belief.evidence_ids]} for belief in world.crm_beliefs
                   if belief.retracted_at_utc is None}
        context = session.metadata.get("call_context", {})
        cycles = self.store.list(session.tenant_id, "cycle", session_id=session.session_id, limit=1)
        return {
            "conversation": {"state": world.conversation_state.model_dump(mode="json"), "turns": world.context_window,
                             "summary": beliefs.get('SESSION_SUMMARY'), "reflection_status": session.metadata.get('reflection_status')},
            "buyer": {"profile": world.buyer.model_dump(mode="json"), "beliefs": {k: v for k, v in beliefs.items()
                      if k.startswith("BUYER_") or k in {"TURN_ANALYSIS", "SPEAKER_MOOD"}},
                      "objections": [o.model_dump(mode="json") for o in world.active_objections]},
            "salesperson": {"id": session.salesperson_id, "feedback": self.learning(session.tenant_id)},
            "deal": {"phase": world.conversation_state.phase.value, "goal": context.get("call_goal"),
                     "crm": session.metadata.get("crm", {}), "prediction": beliefs.get("DEAL_PREDICTION"),
                     "decision": beliefs.get("EXECUTIVE_DECISION")},
            "product": {key: value for key, value in context.items() if key.startswith("product_")},
            "organization": {"policy": self.policy(session.tenant_id).model_dump(),
                             "context": session.metadata.get("organization", {})},
            "system": {"world_version": world.version, "profile": [n["id"] for n in cycles[0]["graph"]] if cycles else [],
                       "last_cycle": cycles[0] if cycles else None, "as_of": utc_now().isoformat()},
        }
