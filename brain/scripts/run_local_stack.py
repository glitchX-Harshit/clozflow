"""Start, inspect or stop the three local ClozFlow services owned by this launcher."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

import psutil

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'logs/local-stack.json'


def alive(record):
    try:
        process = psutil.Process(record['pid'])
        return process if abs(process.create_time() - record['created']) < .01 else None
    except psutil.NoSuchProcess:
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'], nargs='?', default='start')
    parser.add_argument('--project-dir', type=Path, default=ROOT.parent)
    parser.add_argument('--main-port', type=int, default=8100)
    parser.add_argument('--brain-port', type=int, default=8110)
    parser.add_argument('--ui-port', type=int, default=5273)
    args = parser.parse_args()
    records = json.loads(STATE.read_text()) if STATE.exists() else {}
    if args.action == 'status':
        print(json.dumps({name: {'running': bool(alive(record)), 'url': record['url']} for name, record in records.items()}, indent=2))
        return
    if args.action == 'stop':
        for record in reversed(list(records.values())):
            process = alive(record)
            if process:
                # Identity includes OS creation time, so a recycled PID is never stopped.
                children = process.children(recursive=True)
                process.terminate()
                for child in children:
                    try:
                        child.terminate()
                    except psutil.NoSuchProcess:
                        pass
                psutil.wait_procs([process, *children], timeout=10)
        print('Stopped launcher-owned services. Saved sessions remain on disk.')
        return
    project = args.project_dir.resolve(strict=True)
    python = sys.executable
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required for the main UI.')
    definitions = {
        'brain': (args.brain_port, ROOT, [python, '-u', 'scripts/run_api.py'], '/health'),
        'main': (args.main_port, project / 'backend', [python, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', str(args.main_port)], '/health'),
        'frontend': (args.ui_port, project / 'frontend', [node, 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', str(args.ui_port), '--strictPort'], '/brain'),
    }
    ports = [item[0] for item in definitions.values()]
    if len(set(ports)) != 3 or any(port < 1024 or port > 65535 for port in ports):
        raise SystemExit('Choose three distinct ports between 1024 and 65535.')
    # Check every port before launching any child; never stop unrelated services.
    for name, (port, _, _, check) in definitions.items():
        if name in records and alive(records[name]):
            if records[name]['url'] != f'http://127.0.0.1:{port}{check}':
                raise SystemExit('Stop this checkout before changing its ports.')
            continue
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise SystemExit(f'Port {port} is in use by another process; it was not stopped.')
    ROOT.joinpath('logs').mkdir(exist_ok=True)
    for name, (port, cwd, command, check) in definitions.items():
        if name in records and alive(records[name]):
            continue
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise SystemExit(f'Port {port} is in use by another process; it was not stopped.')
        env = os.environ.copy()
        env['PYTHONUTF8'] = '1'
        env['CEB_PORT'] = str(args.brain_port)
        env['CLOZFLOW_BRAIN_URL'] = f'http://127.0.0.1:{args.brain_port}'
        env['CLOZFLOW_COPILOT_ENGINE'] = 'brain'
        env['CLOZFLOW_LOCAL_MODE'] = '1'
        env['ALLOWED_ORIGINS'] = f'http://127.0.0.1:{args.ui_port},http://localhost:{args.ui_port}'
        env['VITE_AUTH_MODE'] = 'local'
        env['VITE_API_BASE_URL'] = f'http://127.0.0.1:{args.main_port}'
        env['VITE_WS_BASE_URL'] = f'ws://127.0.0.1:{args.main_port}'
        if name == 'main':
            env['DATABASE_URL'] = 'sqlite:///' + (project / 'backend/hexagon.db').as_posix()
        with (ROOT / f'logs/{name}-stack.log').open('a', encoding='utf-8') as stream:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        records[name] = {'pid': process.pid, 'created': psutil.Process(process.pid).create_time(), 'url': f'http://127.0.0.1:{port}{check}'}
        STATE.write_text(json.dumps(records, indent=2))
        ready = False
        for _ in range(60):
            if process.poll() is not None:
                break
            try:
                with urlopen(records[name]['url'], timeout=1) as response:
                    ready = response.status == 200
                if ready:
                    break
            except Exception:
                time.sleep(.5)
        if not ready:
            raise SystemExit(f'{name} did not become ready. See logs/{name}-stack.log')
        print(f'{name} ready: {records[name]["url"]}')
    print(f'Open http://127.0.0.1:{args.ui_port}/brain — create a local account or sign in.')


if __name__ == '__main__':
    main()
