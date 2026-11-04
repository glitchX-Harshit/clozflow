"""Application service for CCPA/CILF artifact management."""

from __future__ import annotations

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.contracts.persistence import ArtifactLifecycleState, CognitiveArtifact
from clozflow_brain.infrastructure.cognitive_repositories import PersistenceRepository


class PersistenceService:
    def __init__(self, repository: PersistenceRepository) -> None:
        self._repository = repository

    def register_artifact(self, artifact: CognitiveArtifact) -> CognitiveArtifact:
        validated = artifact.model_copy(
            update={"lifecycle_state": ArtifactLifecycleState.PERSISTED, "updated_at_utc": utc_now()}
        )
        return self._repository.save_artifact(validated)

    def transition(
        self,
        artifact: CognitiveArtifact,
        lifecycle_state: ArtifactLifecycleState,
    ) -> CognitiveArtifact:
        updated = artifact.model_copy(
            update={"lifecycle_state": lifecycle_state, "updated_at_utc": utc_now()}
        )
        return self._repository.save_artifact(updated)

