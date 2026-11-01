"""
Benchmark Baseline Manager.
Saves, loads, and catalogues golden baseline evaluation snapshots.
"""
import json
from pathlib import Path
from typing import Dict, Any, List, Optional


class BenchmarkManager:
    """Manages versioned baseline benchmarks for CI regression tracking."""

    def __init__(self, benchmarks_dir: Optional[Path] = None):
        self.benchmarks_dir = benchmarks_dir or Path(__file__).parent.resolve()
        self.benchmarks_dir.mkdir(parents=True, exist_ok=True)

    def save_baseline(self, name: str, suite_summary: Dict[str, Any]) -> Path:
        """Saves a completed evaluation suite summary as a named baseline."""
        filename = f"{name}.json" if not name.endswith(".json") else name
        filepath = self.benchmarks_dir / filename
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(suite_summary, f, indent=2)
        return filepath

    def load_baseline(self, name: str) -> Dict[str, Any]:
        """Loads a baseline benchmark JSON by name."""
        filename = f"{name}.json" if not name.endswith(".json") else name
        filepath = self.benchmarks_dir / filename
        if not filepath.exists():
            raise FileNotFoundError(f"Baseline '{name}' not found at {filepath}")
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)

    def list_baselines(self) -> List[str]:
        """Lists all stored baselines."""
        return [p.stem for p in self.benchmarks_dir.glob("*.json")]
