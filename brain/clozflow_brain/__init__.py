"""Source-checkout import shim for the ClozFlow Brain package.

The implementation lives under ``src/clozflow_brain``. This shim lets local
commands such as ``python -m uvicorn clozflow_brain.api.main:create_app`` work
from the repository root even before the package is installed editable.
"""

from __future__ import annotations

from pathlib import Path

_src_package = Path(__file__).resolve().parents[1] / "src" / "clozflow_brain"
if _src_package.is_dir():
    __path__.append(str(_src_package))  # type: ignore[name-defined]

__version__ = "0.1.0"

