from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clozflow_brain.infrastructure.factory import (
    build_event_bus_from_env,
    build_persistence_repository_from_env,
    build_session_repository_from_env,
    build_world_model_repository_from_env,
)
from clozflow_brain.infrastructure.repositories import (
    InMemorySessionRepository,
    InMemoryWorldModelRepository,
)
from clozflow_brain.kernel.buses import InMemoryEventBus


class InfrastructureFactoryTests(unittest.TestCase):
    def test_defaults_are_local_development_safe(self) -> None:
        keys = [
            "CEB_EVENT_BUS",
            "CEB_SESSION_REPOSITORY",
            "CEB_WORLD_MODEL_REPOSITORY",
            "CEB_PERSISTENCE_REPOSITORY",
        ]
        with patch.dict(os.environ, {key: "" for key in keys}, clear=False):
            for key in keys:
                os.environ.pop(key, None)

            self.assertIsInstance(build_event_bus_from_env(), InMemoryEventBus)
            self.assertIsInstance(build_session_repository_from_env(), InMemorySessionRepository)
            self.assertIsInstance(
                build_world_model_repository_from_env(),
                InMemoryWorldModelRepository,
            )
            self.assertIsNotNone(build_persistence_repository_from_env())


if __name__ == "__main__":
    unittest.main()

