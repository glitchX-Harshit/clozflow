"""Run the ClozFlow Brain API from a source checkout.

This launcher keeps local development independent of whether the package has been
installed editable in the active Python environment.
"""

from __future__ import annotations

import sys
import os
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    src_path = repo_root / "src"
    sys.path.insert(0, str(src_path))
    os.chdir(repo_root)
    from dotenv import load_dotenv
    load_dotenv(repo_root / ".env")
    (repo_root / "data").mkdir(exist_ok=True)
    os.environ.setdefault("CEB_STORAGE_PROFILE", "durable")

    try:
        import uvicorn
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "uvicorn is not installed for this Python interpreter. "
            "Run `python -m pip install -e .` from the repository root first."
        ) from exc

    uvicorn.run(
        "clozflow_brain.api.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=int(os.getenv("CEB_PORT", "8010")),
        reload=False,
    )


if __name__ == "__main__":
    main()

