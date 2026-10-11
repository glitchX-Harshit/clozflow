"""
Clozflow Admin Intelligence — Database Migration
Safely updates hexagon.db with admin attributes and creates the new admin tables.
Preserves all existing data.
"""
import sqlite3
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import SQLALCHEMY_DATABASE_URL, engine, Base
import models  # This triggers model registration with Base

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "hexagon.db")

USER_ADMIN_COLUMNS = [
    ("is_admin",       "INTEGER DEFAULT 0"),
    ("admin_role",     "TEXT DEFAULT 'user'"),
    ("account_status", "TEXT DEFAULT 'active'"),
    ("credit_balance", "INTEGER DEFAULT 0"),
]


def get_existing_columns(cursor, table: str):
    cursor.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


def migrate_admin():
    print(f"Running Admin Migration on: {DB_PATH}")

    # First, use SQLAlchemy Base metadata to create any missing tables
    Base.metadata.create_all(bind=engine)
    print("  [OK] Ensured all SQLAlchemy metadata tables are registered")

    # If running SQLite, check column migrations on users
    if os.path.exists(DB_PATH):
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()

        existing_user_cols = get_existing_columns(cur, "users")
        added = 0
        for col_name, col_type in USER_ADMIN_COLUMNS:
            if col_name not in existing_user_cols:
                cur.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
                print(f"  [+] Added users.{col_name}")
                added += 1
            else:
                print(f"  [.] Skipped users.{col_name} (already exists)")

        # Create indexes if not exist
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_admin_role ON users(admin_role)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status)")

        conn.commit()
        conn.close()
        print(f"Admin migration complete. {added} column(s) added.")
    else:
        print("  [!] SQLite database file not found at default path, created via SQLAlchemy engine.")


if __name__ == "__main__":
    migrate_admin()
