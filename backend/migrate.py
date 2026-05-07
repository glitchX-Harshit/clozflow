"""
Run once to migrate existing hexagon.db to the new schema.
Adds all new columns to the users table without losing existing data.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "hexagon.db")

NEW_COLUMNS = [
    ("username",               "TEXT"),
    ("full_name",              "TEXT"),
    ("bio",                    "TEXT"),
    ("company_name",           "TEXT"),
    ("role",                   "TEXT"),
    ("profile_image",          "TEXT"),
    ("updated_at",             "DATETIME"),
    ("workspace_name",         "TEXT"),
    ("team_size",              "TEXT"),
    ("sales_style",            "TEXT DEFAULT 'Controlled Challenge'"),
    ("ai_response_length",     "TEXT DEFAULT 'balanced'"),
    ("ai_tone",                "TEXT DEFAULT 'assertive'"),
    ("ai_objection_pressure",  "TEXT DEFAULT 'balanced'"),
    ("ai_speed",               "TEXT DEFAULT 'balanced'"),
    ("notif_call_summary",     "INTEGER DEFAULT 1"),
    ("notif_objection_alerts", "INTEGER DEFAULT 0"),
    ("notif_deal_risk",        "INTEGER DEFAULT 1"),
    ("notif_coaching",         "INTEGER DEFAULT 1"),
]

CALL_LOG_COLUMNS = [
    ("message_count", "INTEGER DEFAULT 0"),
    ("insight_count", "INTEGER DEFAULT 0"),
]

def get_existing_columns(cursor, table):
    cursor.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}

def migrate():
    print(f"Migrating: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ── users table ──────────────────────────────────
    existing = get_existing_columns(cur, "users")
    added = 0
    for col_name, col_type in NEW_COLUMNS:
        if col_name not in existing:
            sql = f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"
            cur.execute(sql)
            print(f"  [+] Added users.{col_name}")
            added += 1
        else:
            print(f"  · Skipped users.{col_name} (already exists)")

    # ── call_logs table ───────────────────────────────
    existing_cl = get_existing_columns(cur, "call_logs")
    for col_name, col_type in CALL_LOG_COLUMNS:
        if col_name not in existing_cl:
            cur.execute(f"ALTER TABLE call_logs ADD COLUMN {col_name} {col_type}")
            print(f"  [+] Added call_logs.{col_name}")
            added += 1
        else:
            print(f"  · Skipped call_logs.{col_name} (already exists)")

    conn.commit()
    conn.close()
    print(f"\nMigration complete. {added} column(s) added.")

if __name__ == "__main__":
    migrate()
