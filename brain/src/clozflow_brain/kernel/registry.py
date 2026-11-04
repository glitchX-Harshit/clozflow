"""Cognitive engine registry."""

from __future__ import annotations

import importlib
import os
from threading import RLock
import yaml

from clozflow_brain.contracts.engines import CognitiveEngine
from clozflow_brain.contracts.events import EventType


class EngineRegistry:
    """Stores replaceable cognitive engines behind their published contracts."""

    def __init__(self) -> None:
        self._engines: dict[str, CognitiveEngine] = {}
        self._class_paths: dict[str, str] = {}
        self._lock = RLock()

    def register(self, engine: CognitiveEngine, class_path: str | None = None) -> None:
        registration = engine.registration
        with self._lock:
            if registration.engine_id in self._engines:
                raise ValueError(f"engine already registered: {registration.engine_id}")
            self._engines[registration.engine_id] = engine
            if class_path:
                self._class_paths[registration.engine_id] = class_path

    def load_from_yaml(self, file_path: str) -> None:
        """Loads and instantiates cognitive engines declared in a YAML configuration file."""
        if not os.path.isabs(file_path):
            # Resolve relative to workspace root if not absolute
            current_dir = os.path.dirname(os.path.abspath(__file__))
            root_dir = os.path.abspath(os.path.join(current_dir, "..", "..", ".."))
            file_path = os.path.join(root_dir, file_path)

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Engines configuration file not found: {file_path}")

        with open(file_path, "r", encoding="utf-8") as f:
            config_data = yaml.safe_load(f)

        engines_list = config_data.get("engines", [])
        for eng_cfg in engines_list:
            class_path = eng_cfg.get("class_path")
            if not class_path:
                raise ValueError(f"Missing 'class_path' for engine ID '{eng_cfg.get('engine_id')}' in config.")

            # Dynamically import module and class
            try:
                module_path, class_name = class_path.rsplit(".", 1)
                module = importlib.import_module(module_path)
                engine_class = getattr(module, class_name)
            except (ValueError, ModuleNotFoundError, AttributeError) as exc:
                raise ImportError(f"Failed to import engine class path '{class_path}': {exc}") from exc

            # Instantiate and validate
            engine_inst = engine_class()
            if not (hasattr(engine_inst, "registration") and hasattr(engine_inst, "execute")):
                raise TypeError(f"Engine class '{class_path}' does not conform to CognitiveEngine protocol.")

            registration = engine_inst.registration
            # Basic validation of loaded registration against config parameters
            if registration.engine_id != eng_cfg.get("engine_id"):
                raise ValueError(f"Engine ID mismatch: config has '{eng_cfg.get('engine_id')}' but class has '{registration.engine_id}'")
            if registration.engine_type.value != eng_cfg.get("engine_type"):
                raise ValueError(f"Engine type mismatch for '{registration.engine_id}'")
            if registration.priority != eng_cfg.get("priority"):
                raise ValueError(f"Priority mismatch for '{registration.engine_id}'")
            if registration.latency_budget_ms != eng_cfg.get("latency_budget_ms"):
                raise ValueError(f"Latency budget mismatch for '{registration.engine_id}'")

            self.register(engine_inst, class_path=class_path)

    def get(self, engine_id: str) -> CognitiveEngine:
        with self._lock:
            return self._engines[engine_id]

    def get_class_path(self, engine_id: str) -> str | None:
        with self._lock:
            return self._class_paths.get(engine_id)

    def all(self) -> list[CognitiveEngine]:
        with self._lock:
            return list(self._engines.values())

    def match_event_types(self, event_types: set[EventType]) -> list[CognitiveEngine]:
        with self._lock:
            engines = [
                engine
                for engine in self._engines.values()
                if event_types.intersection(set(engine.registration.input_types))
            ]
        return sorted(engines, key=lambda engine: engine.registration.priority)


