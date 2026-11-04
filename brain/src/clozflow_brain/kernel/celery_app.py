"""Celery task queue configuration and task definitions for ClozFlow Cognitive Brain."""

from __future__ import annotations

import importlib
import os
from typing import Any
import yaml
from celery import Celery

from clozflow_brain.contracts.engines import EngineExecutionInput


def get_broker_url() -> str:
    """Read broker URL from configs/brain.yaml or default to local redis."""
    if os.getenv("CEB_CELERY_BROKER_URL") or os.getenv("CEB_REDIS_URL"):
        return os.getenv("CEB_CELERY_BROKER_URL") or os.environ["CEB_REDIS_URL"]
    broker_url = "redis://localhost:6379/0"
    # Find workspace root relative to this file path
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # Go up from src/clozflow_brain/kernel to workspace root
    root_dir = os.path.abspath(os.path.join(current_dir, "..", "..", ".."))
    config_path = os.path.join(root_dir, "configs", "brain.yaml")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config_data = yaml.safe_load(f)
                redis_url = config_data.get("world_model", {}).get("redis", {}).get("url")
                if redis_url:
                    broker_url = redis_url
        except Exception:  # pylint: disable=broad-except
            pass
    return broker_url


broker_url = get_broker_url()
celery_app = Celery("clozflow_brain", broker=broker_url, backend=broker_url)

# Configure Celery settings with default support for 5 priorities
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_always_eager=os.getenv("CEB_CELERY_ALWAYS_EAGER", "False").lower() in ("true", "1", "yes"),  # Set to True in tests
    task_track_started=True,
    task_time_limit=30,  # absolute fallback timeout in seconds
)


@celery_app.task(name="clozflow_brain.execute_engine")
def execute_engine_task(engine_class_path: str, request_dict: dict[str, Any]) -> dict[str, Any]:
    """ Statelessly instantiates and runs a cognitive engine. """
    # Deserialize input
    request = EngineExecutionInput.model_validate(request_dict)

    # Dynamically load the engine class
    module_path, class_name = engine_class_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    engine_class = getattr(module, class_name)
    engine = engine_class()

    # Execute the engine
    output = engine.execute(request)

    # Return serialized output
    return output.model_dump(mode="json")
