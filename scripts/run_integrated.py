"""Run only this checkout's isolated development services."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).resolve().parents[1] / 'brain/scripts/run_local_stack.py'), run_name='__main__')
