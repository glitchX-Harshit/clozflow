import unittest
import asyncio
from uuid import uuid4

from clozflow_brain.contracts.sessions import BrainSession, SessionStatus
from clozflow_brain.infrastructure.repositories import (
    InMemorySessionRepository,
    InMemoryWorldModelRepository,
    InMemoryWorldModelCheckpointRepository,
)
from clozflow_brain.kernel.checkpointer import WorldModelCheckpointer


class TestWorldModelCheckpointer(unittest.IsolatedAsyncioTestCase):
    async def test_checkpoint_active_sessions(self):
        session_repo = InMemorySessionRepository()
        world_model_repo = InMemoryWorldModelRepository()
        checkpoint_repo = InMemoryWorldModelCheckpointRepository()

        # Create active and closed sessions
        tenant_id = uuid4()
        active_sess = BrainSession(
            session_id=uuid4(),
            tenant_id=tenant_id,
            salesperson_id="rep-active",
            status=SessionStatus.ACTIVE,
        )
        closed_sess = BrainSession(
            session_id=uuid4(),
            tenant_id=tenant_id,
            salesperson_id="rep-closed",
            status=SessionStatus.TERMINATED,  # TERMINATED is non-active
        )

        session_repo.save(active_sess)
        session_repo.save(closed_sess)

        # Create World Models
        world_model_repo.create(active_sess)
        world_model_repo.create(closed_sess)

        checkpointer = WorldModelCheckpointer(
            session_repo=session_repo,
            world_model_repo=world_model_repo,
            checkpoint_repo=checkpoint_repo,
            interval_seconds=0.1,
        )

        # Force checkpoint manually first
        await checkpointer.checkpoint_active_sessions()

        # Active session should be checkpointed
        cp_active = checkpoint_repo.get_latest_checkpoint(active_sess.session_id)
        assert cp_active is not None
        self.assertEqual(cp_active.session_id, active_sess.session_id)

        # Closed session should not be checkpointed
        cp_closed = checkpoint_repo.get_latest_checkpoint(closed_sess.session_id)
        self.assertIsNone(cp_closed)

    async def test_checkpointer_loop(self):
        session_repo = InMemorySessionRepository()
        world_model_repo = InMemoryWorldModelRepository()
        checkpoint_repo = InMemoryWorldModelCheckpointRepository()

        active_sess = BrainSession(
            session_id=uuid4(),
            tenant_id=uuid4(),
            salesperson_id="rep-loop",
            status=SessionStatus.ACTIVE,
        )
        session_repo.save(active_sess)
        world_model_repo.create(active_sess)

        checkpointer = WorldModelCheckpointer(
            session_repo=session_repo,
            world_model_repo=world_model_repo,
            checkpoint_repo=checkpoint_repo,
            interval_seconds=0.01,
        )

        await checkpointer.start()
        await asyncio.sleep(0.05)
        await checkpointer.stop()

        cp = checkpoint_repo.get_latest_checkpoint(active_sess.session_id)
        self.assertIsNotNone(cp)
