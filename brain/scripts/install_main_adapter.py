"""Install the reviewed local adapter into the sibling ClozFlow application."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = args.project_dir.resolve(strict=True)
    brain_root = Path(__file__).resolve().parents[1]
    stage = brain_root / "integrations/main_app"
    manifest = json.loads((stage / "install-manifest.json").read_text())
    files = {relative: stage / relative for relative in manifest}
    for relative, source in files.items():
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise ValueError("Target must remain inside the main project")
        if target.exists():
            current = hashlib.sha256(target.read_bytes()).hexdigest()
            prepared = hashlib.sha256(source.read_bytes()).hexdigest()
            if current not in {manifest.get(relative), prepared}:
                raise RuntimeError(f"File changed after preparation; review required: {relative}")
    if not args.apply:
        print("Validated prepared changes:", ", ".join(files))
        return
    backup = brain_root / "logs/main-app-backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    for relative, source in files.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            saved = backup / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, saved)
        shutil.copy2(source, target)
    from dotenv import set_key
    set_key(root / ".env", "CLOZFLOW_COPILOT_ENGINE", "brain")
    set_key(root / ".env", "CLOZFLOW_BRAIN_URL", "http://127.0.0.1:8110")
    set_key(root / ".env", "CLOZFLOW_BRAIN_TIMEOUT_SECONDS", "300")
    from dotenv import dotenv_values
    import secrets
    values = dotenv_values(root / ".env")
    if not values.get("JWT_SECRET_KEY"):
        set_key(root / ".env", "JWT_SECRET_KEY", secrets.token_urlsafe(48))
    set_key(root / ".env", "CLOZFLOW_LOCAL_MODE", "1")
    if dotenv_values(root / "frontend/.env.local").get("VITE_AUTH_MODE") != "local":
        set_key(root / "frontend/.env.local", "VITE_AUTH_MODE", "local")
    (stage / 'install-manifest.json').write_text(json.dumps({relative: hashlib.sha256(source.read_bytes()).hexdigest()
        for relative, source in files.items()}, indent=2), encoding='utf-8')
    print("Installed local Brain workspace. Existing provider credentials were preserved.")
    print("Original code backup:", backup)


if __name__ == "__main__":
    main()
