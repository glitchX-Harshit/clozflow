import os
import pytest
from typing import Any, Type, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

os.environ["CEB_LLM_PROVIDER"] = "local"
os.environ["CEB_SCHEDULER_MODE"] = "local"
os.environ["CEB_ENGINES_CONFIG"] = "configs/engines.yaml"

def mock_resolve_field(name: str, field: Any, prompt_lower: str) -> Any:
    resolved_type = field.annotation
    
    # Handle optionals
    if hasattr(resolved_type, "__origin__") and resolved_type.__origin__ is list:
        inner_type = getattr(resolved_type, "__args__", [str])[0]
        if hasattr(inner_type, "model_fields"):
            return [mock_generate_model(prompt_lower, inner_type)]
        return ["test_item"]
        
    if hasattr(resolved_type, "__origin__") and resolved_type.__origin__ is int:
        return 1

    if getattr(resolved_type, "__name__", "") == "str" or resolved_type is str:
        return "test_string"

    if resolved_type is float:
        return 0.99

    if resolved_type is int:
        return 8

    if resolved_type is bool:
        return True

    # Check for Enums
    if hasattr(resolved_type, "__members__"):
        return list(resolved_type.__members__.values())[0]

    # Nested BaseModel
    if hasattr(resolved_type, "model_fields"):
        return mock_generate_model(prompt_lower, resolved_type)

    return None

def mock_generate_model(prompt_lower: str, response_schema: Type[T]) -> Any:
    payload = {}
    for name, field in response_schema.model_fields.items():
        payload[name] = mock_resolve_field(name, field, prompt_lower)
    return response_schema.model_validate(payload)

@pytest.fixture(autouse=True)
def mock_local_llm(monkeypatch):
    """Automatically mock LocalLLMClient.generate_structured_output for all tests to keep them fast."""
    
    def dummy_generate(self, prompt, response_schema, *args, **kwargs):
        return mock_generate_model(prompt.lower(), response_schema)
        
    # Patch the method on the class
    monkeypatch.setattr("clozflow_brain.infrastructure.llm_local.LocalLLMClient.generate_structured_output", dummy_generate)


@pytest.fixture
def local_env(monkeypatch, tmp_path):
    for name in ("SESSION", "WORLD_MODEL", "MEMORY", "CONTEXT", "KNOWLEDGE", "PERSISTENCE"):
        monkeypatch.setenv(f"CEB_{name}_REPOSITORY", "memory")
    monkeypatch.setenv("CEB_EVENT_BUS", "memory")
    monkeypatch.setenv("CEB_AUTH_MODE", "local")
    monkeypatch.setenv("CEB_SCHEDULER_MODE", "local")
    monkeypatch.setenv("CEB_EMBEDDING_CLIENT", "mock")
    monkeypatch.setenv("CEB_QDRANT_MODE", "memory")

