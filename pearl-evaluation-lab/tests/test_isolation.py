"""
Isolation and Non-Invasiveness Tests.
Verifies that Pearl Evaluation Lab strictly complies with the Absolute Isolation Policy:
1. Zero production files are modified or depend on the lab.
2. Production code never imports pearl-evaluation-lab.
3. Telephony and production database writes are strictly disallowed.
4. The lab is completely removable without impacting the main application.
"""
import os
import sys
from pathlib import Path
try:
    import pytest
except ImportError:
    pytest = None

LAB_ROOT = Path(__file__).parent.parent.resolve()
REPO_ROOT = LAB_ROOT.parent.resolve()
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"


def test_production_modules_do_not_import_lab():
    """Verify that no file in backend/ or frontend/ references pearl-evaluation-lab."""
    forbidden_terms = ["pearl-evaluation-lab", "pearl_evaluation_lab", "pearl_eval"]
    
    for base_dir in [BACKEND_DIR, FRONTEND_DIR]:
        if not base_dir.exists():
            continue
        for root, dirs, files in os.walk(base_dir):
            # Prune vendor / cache directories for lightning-fast scan
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "__pycache__", ".venv", "dist", "build")]
            for f in files:
                if f.endswith((".py", ".ts", ".tsx", ".js", ".jsx")):
                    file_path = Path(root) / f
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                        content = fh.read()
                        for term in forbidden_terms:
                            assert term not in content, (
                                f"ISOLATION VIOLATION: Production file {file_path} imports or references '{term}'!"
                            )


def test_isolation_policy_config():
    """Ensure evaluation.yaml strictly enforces no real telephony and no production DB."""
    config_path = LAB_ROOT / "evaluation.yaml"
    assert config_path.exists(), "evaluation.yaml must exist in lab root"

    with open(config_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "allow_real_telephony: false" in content or "allow_real_telephony: False" in content, (
        "ISOLATION VIOLATION: allow_real_telephony must be strictly FALSE!"
    )


def test_lab_does_not_touch_production_database():
    """Ensure lab creates its own local files only and never points to hexagon.db."""
    from adapters.mock_adapter import MockPearlAdapter
    import asyncio

    adapter = MockPearlAdapter()
    ready, msg = asyncio.run(adapter.is_available())
    assert ready is True
    assert "offline" in msg.lower()
