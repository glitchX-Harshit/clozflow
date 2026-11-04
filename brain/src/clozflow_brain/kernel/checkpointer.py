"""Background service for checkpointing World Model hot state (Redis) to PostgreSQL."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from clozflow_brain.infrastructure.repositories import (
    SessionRepository,
    WorldModelCheckpointRepository,
    WorldModelRepository,
)

logger = logging.getLogger(__name__)


class WorldModelCheckpointer:
    """Manages periodic checkpointing of World Model states from hot storage to database checkpoints."""

    def __init__(
        self,
        session_repo: SessionRepository,
        world_model_repo: WorldModelRepository,
        checkpoint_repo: WorldModelCheckpointRepository,
        interval_seconds: float = 60.0,
    ) -> None:
        self.session_repo = session_repo
        self.world_model_repo = world_model_repo
        self.checkpoint_repo = checkpoint_repo
        self.interval_seconds = interval_seconds
        self._task: asyncio.Task[Any] | None = None
        self._running = False

    async def start(self) -> None:
        """Start the background checkpointer loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("WorldModelCheckpointer background task started (interval: %s s).", self.interval_seconds)

    async def stop(self) -> None:
        """Stop the background checkpointer loop."""
        if not self._running:
            return
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("WorldModelCheckpointer background task stopped.")

    async def _run_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self.interval_seconds)
                await self.checkpoint_active_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Unexpected error in checkpointer loop: %s", e)

    async def checkpoint_active_sessions(self) -> None:
        """Fetch all active sessions and persist their hot Redis World Model to SQL database."""
        try:
            active_sessions = self.session_repo.list_all_active()
            for session in active_sessions:
                try:
                    world_model = self.world_model_repo.get(session.session_id)
                    self.checkpoint_repo.write_checkpoint(world_model)
                    logger.debug("Successfully checkpointed World Model for session: %s", session.session_id)
                except KeyError:
                    logger.warning("No hot World Model found for active session: %s", session.session_id)
                except Exception as e:
                    logger.error("Failed to checkpoint World Model for session %s: %s", session.session_id, e)
        except Exception as e:
            logger.error("Failed to query active sessions for checkpointing: %s", e)
