"""Migrate the active SQLite payloads to the configured local encryption key."""
import os
from pathlib import Path
import sqlite3
from datetime import datetime
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from dotenv import load_dotenv  # noqa: E402
from clozflow_brain.infrastructure.data_codec import encode, decode, PREFIX  # noqa: E402


def main():
    load_dotenv(ROOT / '.env')
    if not os.getenv('CEB_DATA_KEY_FILE'):
        raise SystemExit('Set CEB_DATA_KEY_FILE before migrating.')
    path = ROOT / 'data/runtime.sqlite'
    backup = ROOT / 'logs' / f'runtime-before-encryption-{datetime.now():%Y%m%d-%H%M%S}.sqlite'
    with sqlite3.connect(path) as db, sqlite3.connect(backup) as saved:
        db.backup(saved)
        count = 0
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            # Only local schema identifiers are used; quote them as SQLite identifiers.
            table = '"' + name.replace('"', '""') + '"'
            for column in db.execute(f'PRAGMA table_info({table})').fetchall():
                if not column[1].endswith('_json'):
                    continue
                field = '"' + column[1].replace('"', '""') + '"'
                for rowid, value in db.execute(f'SELECT rowid, {field} FROM {table}').fetchall():
                    if value is None or value.startswith(PREFIX):
                        continue
                    encrypted = encode(value)
                    assert decode(encrypted) == value
                    db.execute(f'UPDATE {table} SET {field}=? WHERE rowid=?', (encrypted, rowid))
                    count += 1
        db.commit()
    print(f'Encrypted {count} payloads. Pre-migration backup retained in logs; keep the data key with this Windows account.')


if __name__ == '__main__':
    main()
