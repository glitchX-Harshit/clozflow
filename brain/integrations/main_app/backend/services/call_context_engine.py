"""Durable local call briefs with a bounded cache and four-hour resume window."""
import time
import uuid
from threading import RLock

from sqlalchemy import Column, Float, JSON, MetaData, String, Table, select
from database import engine

metadata = MetaData()
briefs = Table('local_call_contexts', metadata,
    Column('context_id', String(36), primary_key=True),
    Column('created_at', Float, nullable=False), Column('payload', JSON, nullable=False))


class CallContextEngine:
    def __init__(self, max_sessions=2000, ttl_seconds=14400):
        self.sessions = {}
        self.max_sessions = max_sessions
        self.ttl_seconds = ttl_seconds
        self._lock = RLock()
        metadata.create_all(engine)

    def create_context(self, user_id, client_name, client_industry, client_role,
                       product_name, product_price, product_specification, call_goal):
        context_id = str(uuid.uuid4())
        context = dict(user_id=user_id, client_name=client_name, client_industry=client_industry,
            client_role=client_role, product_name=product_name, product_price=product_price,
            product_specification=product_specification, call_goal=call_goal, created_at=time.time())
        with self._lock, engine.begin() as conn:
            conn.execute(briefs.insert().values(context_id=context_id, created_at=context['created_at'], payload=context))
            self._cache(context_id, context)
        return context_id

    def _cache(self, context_id, context):
        if len(self.sessions) >= self.max_sessions:
            self.sessions.pop(next(iter(self.sessions)))
        self.sessions[context_id] = context

    def get_context(self, context_id):
        with self._lock:
            context = self.sessions.get(context_id)
            if context is None:
                with engine.connect() as conn:
                    context = conn.execute(select(briefs.c.payload).where(briefs.c.context_id == context_id)).scalar_one_or_none()
                if context:
                    self._cache(context_id, context)
            if not context or time.time() - context.get('created_at', 0) > self.ttl_seconds:
                self.sessions.pop(context_id, None)
                return None
            return dict(context)

    def delete_context(self, context_id):
        with self._lock, engine.begin() as conn:
            self.sessions.pop(context_id, None)
            conn.execute(briefs.delete().where(briefs.c.context_id == context_id))


call_context_engine = CallContextEngine()
