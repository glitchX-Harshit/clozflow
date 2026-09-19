"""
Clozflow Relay V1 — Database Migration
Run once to create Relay tables in the existing hexagon.db.
Follows the same pattern as the existing migrate.py.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "hexagon.db")


def migrate_relay():
    print(f"Relay Migration: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ── relays table ──────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS relays (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            slug              TEXT UNIQUE NOT NULL,
            user_id           INTEGER NOT NULL REFERENCES users(id),
            call_id           INTEGER NOT NULL REFERENCES call_logs(id),
            status            TEXT DEFAULT 'draft',
            prospect_name     TEXT,
            prospect_email    TEXT,
            prospect_business TEXT,
            summary           TEXT,
            benefits          TEXT,
            next_step         TEXT,
            seller_name       TEXT,
            seller_company    TEXT,
            created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            published_at      DATETIME
        )
    """)
    print("  [+] Ensured relays table exists")

    # ── relay_availability_slots table ────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS relay_availability_slots (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            relay_id          INTEGER NOT NULL REFERENCES relays(id),
            date              TEXT NOT NULL,
            start_time        TEXT NOT NULL,
            end_time          TEXT NOT NULL,
            duration_minutes  INTEGER DEFAULT 30,
            meeting_type      TEXT DEFAULT 'Video Call',
            is_booked         INTEGER DEFAULT 0,
            created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("  [+] Ensured relay_availability_slots table exists")

    # ── relay_bookings table ─────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS relay_bookings (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            relay_id          INTEGER NOT NULL REFERENCES relays(id),
            slot_id           INTEGER NOT NULL REFERENCES relay_availability_slots(id),
            buyer_name        TEXT NOT NULL,
            buyer_email       TEXT,
            buyer_phone       TEXT,
            status            TEXT DEFAULT 'confirmed',
            created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("  [+] Ensured relay_bookings table exists")

    # ── relay_questions table ────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS relay_questions (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            relay_id          INTEGER NOT NULL REFERENCES relays(id),
            question_text     TEXT NOT NULL,
            answer_text       TEXT,
            asked_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            answered_at       DATETIME
        )
    """)
    print("  [+] Ensured relay_questions table exists")

    # ── Create index on slug for fast public lookups ─────────
    cur.execute("CREATE INDEX IF NOT EXISTS idx_relays_slug ON relays(slug)")
    print("  [+] Ensured index on relays.slug")

    conn.commit()
    conn.close()
    print("\nRelay migration complete.")


if __name__ == "__main__":
    migrate_relay()
