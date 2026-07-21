import uuid

class CallContextEngine:
    def __init__(self):
        self.sessions = {}

    def create_context(self, user_id: int, client_name: str, client_industry: str, client_role: str, product_name: str, product_price: str, product_specification: str, call_goal: str) -> str:
        context_id = str(uuid.uuid4())
        self.sessions[context_id] = {
            "user_id": user_id,
            "client_name": client_name,
            "client_industry": client_industry,
            "client_role": client_role,
            "product_name": product_name,
            "product_price": product_price,
            "product_specification": product_specification,
            "call_goal": call_goal
        }
        return context_id

    def get_context(self, context_id: str) -> dict | None:
        return self.sessions.get(context_id)

call_context_engine = CallContextEngine()
