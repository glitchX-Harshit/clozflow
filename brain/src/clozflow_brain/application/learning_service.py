"""Persist reflection evidence after the kernel commits successful engine output.

No synthetic adherence scores are treated as measured training labels. These
memories inform later retrieval; model weights are never changed implicitly.
"""
from uuid import uuid5

from clozflow_brain.application.memory_service import MemoryService
from clozflow_brain.contracts.engines import EngineExecutionOutput, EngineStatus
from clozflow_brain.contracts.memory import MemoryRecord, MemoryScope, MemoryType
from clozflow_brain.contracts.world_model import WorldModel


def consolidate_reflection(service: MemoryService, world: WorldModel,
                           outputs: list[EngineExecutionOutput]) -> None:
    for output in outputs:
        if output.status != EngineStatus.SUCCESS or output.engine_id != "reflection.concrete":
            continue
        for mutation in output.wm_mutations:
            if mutation.payload.get("belief_type") != "SESSION_SUMMARY":
                continue
            summary = mutation.payload["value"]
            records = [("Session outcome", summary, MemoryType.REFLECTIVE)]
            records += [(f"Unresolved objection: {text}", {"objection": text}, MemoryType.EPISODIC)
                        for text in summary.get("unresolved_objections", [])]
            for subject, content, kind in records:
                service.store(MemoryRecord(
                    memory_id=uuid5(world.session_id, subject), tenant_id=world.tenant_id,
                    memory_type=kind, scope=MemoryScope.TENANT, subject=subject,
                    content={"session_id": str(world.session_id), **content},
                    concepts=subject.lower().split(), confidence=output.confidence,
                    provenance_event_ids=mutation.payload.get("evidence_ids", []),
                ))
