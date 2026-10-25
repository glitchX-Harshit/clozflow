import uuid
import time
from typing import Dict, Any, Optional

class CallContextEngine:
    def __init__(self, max_sessions: int = 2000, ttl_seconds: int = 14400): # 4 hours TTL
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.max_sessions = max_sessions
        self.ttl_seconds = ttl_seconds

    def _evict_stale_sessions(self):
        now = time.time()
        stale_keys = [
            cid for cid, s in self.sessions.items()
            if now - s.get("created_at", 0) > self.ttl_seconds
        ]
        for cid in stale_keys:
            del self.sessions[cid]

        # If still over capacity, remove oldest 20%
        if len(self.sessions) >= self.max_sessions:
            sorted_keys = sorted(
                self.sessions.keys(),
                key=lambda k: self.sessions[k].get("created_at", 0)
            )
            for k in sorted_keys[:self.max_sessions // 5]:
                del self.sessions[k]

    def create_context(
        self,
        user_id: int,
        client_name: str,
        client_industry: str,
        client_role: str,
        product_name: str,
        product_price: str,
        product_specification: str,
        call_goal: str
    ) -> str:
        self._evict_stale_sessions()
        context_id = str(uuid.uuid4())
        self.sessions[context_id] = {
            "user_id": user_id,
            "client_name": client_name,
            "client_industry": client_industry,
            "client_role": client_role,
            "product_name": product_name,
            "product_price": product_price,
            "product_specification": product_specification,
            "call_goal": call_goal,
            "created_at": time.time(),
        }
        return context_id

    def get_context(self, context_id: str) -> Optional[dict]:
        context = self.sessions.get(context_id)
        if not context:
            return None
        # Check if expired
        if time.time() - context.get("created_at", 0) > self.ttl_seconds:
            del self.sessions[context_id]
            return None
        return context

    def delete_context(self, context_id: str):
        if context_id in self.sessions:
            del self.sessions[context_id]

call_context_engine = CallContextEngine()
