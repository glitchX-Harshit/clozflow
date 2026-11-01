#!/usr/bin/env python3
"""
CLI entrypoint wrapper for Pearl Evaluation Lab.
Usage:
    python scripts/pearl_eval_cli.py inspect
    python scripts/pearl_eval_cli.py validate-datasets
    python scripts/pearl_eval_cli.py run --adapter mock --category inbound_enquiries
    python scripts/pearl_eval_cli.py simulate --scenario INB-001
    python scripts/pearl_eval_cli.py regression --baseline v1_baseline
"""
import sys
from pathlib import Path

# Add project root to sys.path
root = Path(__file__).parent.parent.resolve()
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from pearl_eval.cli import main

if __name__ == "__main__":
    main()
