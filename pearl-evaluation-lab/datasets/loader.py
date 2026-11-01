"""
Dataset Loader and Schema Validator.
Loads evaluation scenarios from JSON/JSONL files with filtering and validation.
"""
import os
import json
from pathlib import Path
from typing import List, Dict, Any, Optional

from .schema import EvaluationScenario


def get_default_dataset_dir() -> Path:
    return Path(__file__).parent.resolve()


def load_scenarios(
    category: Optional[str] = None,
    tags: Optional[List[str]] = None,
    scenario_id: Optional[str] = None,
    dataset_dir: Optional[Path] = None
) -> List[EvaluationScenario]:
    """
    Load and parse all evaluation scenarios matching the optional filters.
    """
    root_dir = dataset_dir or get_default_dataset_dir()
    scenarios: List[EvaluationScenario] = []

    for path in root_dir.rglob("*.json*"):
        if not path.is_file():
            continue
        # Ignore schemas or configs
        if path.name.startswith("schema") or path.name.startswith("test"):
            continue

        with open(path, "r", encoding="utf-8") as f:
            if path.suffix == ".jsonl":
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        scenarios.append(EvaluationScenario.parse_obj(data))
                    except Exception as e:
                        print(f"[Dataset Loader Warning] Failed to parse line in {path.name}: {e}")
            elif path.suffix == ".json":
                try:
                    data = json.load(f)
                    if isinstance(data, list):
                        for item in data:
                            scenarios.append(EvaluationScenario.parse_obj(item))
                    elif isinstance(data, dict):
                        scenarios.append(EvaluationScenario.parse_obj(data))
                except Exception as e:
                    print(f"[Dataset Loader Warning] Failed to parse {path.name}: {e}")

    # Apply filters
    filtered = []
    for sc in scenarios:
        if scenario_id and sc.scenario_id.upper() != scenario_id.upper():
            continue
        if category and sc.category.lower() != category.lower():
            continue
        if tags:
            tag_match = any(t.lower() in [st.lower() for st in sc.tags] for t in tags)
            if not tag_match:
                continue
        filtered.append(sc)

    return filtered


def validate_all_datasets(dataset_dir: Optional[Path] = None) -> Dict[str, Any]:
    """
    Validates all dataset files against the EvaluationScenario schema.
    Returns validation report dictionary.
    """
    root_dir = dataset_dir or get_default_dataset_dir()
    results = {
        "total_files": 0,
        "valid_scenarios": 0,
        "errors": [],
        "categories_found": set(),
        "scenario_ids": []
    }

    seen_ids = set()

    for path in root_dir.rglob("*.json*"):
        if not path.is_file() or path.name.startswith("schema"):
            continue

        results["total_files"] += 1
        with open(path, "r", encoding="utf-8") as f:
            items = []
            if path.suffix == ".jsonl":
                for line_idx, line in enumerate(f, start=1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        items.append((line_idx, json.loads(line)))
                    except Exception as e:
                        results["errors"].append({
                            "file": path.name,
                            "line": line_idx,
                            "error": f"JSON syntax error: {str(e)}"
                        })
            else:
                try:
                    data = json.load(f)
                    items = [(1, x) for x in (data if isinstance(data, list) else [data])]
                except Exception as e:
                    results["errors"].append({
                        "file": path.name,
                        "line": 1,
                        "error": f"JSON parse error: {str(e)}"
                    })

            for line_idx, item in items:
                try:
                    sc = EvaluationScenario.parse_obj(item)
                    if sc.scenario_id in seen_ids:
                        results["errors"].append({
                            "file": path.name,
                            "line": line_idx,
                            "scenario_id": sc.scenario_id,
                            "error": f"Duplicate scenario_id '{sc.scenario_id}'"
                        })
                    seen_ids.add(sc.scenario_id)
                    results["valid_scenarios"] += 1
                    results["categories_found"].add(sc.category)
                    results["scenario_ids"].append(sc.scenario_id)
                except Exception as e:
                    results["errors"].append({
                        "file": path.name,
                        "line": line_idx,
                        "error": f"Schema validation error: {str(e)}"
                    })

    results["categories_found"] = list(results["categories_found"])
    results["is_valid"] = len(results["errors"]) == 0
    return results
