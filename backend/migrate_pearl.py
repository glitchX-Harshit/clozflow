"""
Pearl Migration Script
Ensures pearl_agents table has system_prompt, greeting, test_variables, and version columns.
Ensures pearl_test_sessions, pearl_test_messages, pearl_campaigns, and pearl_campaign_recipients tables exist.
Safe to execute repeatedly.
"""
import sqlite3
import os
import sys

# Ensure backend directory is in path
sys.path.insert(0, os.path.dirname(__file__))

from database import engine, Base
import models # loads all models

DB_PATH = os.path.join(os.path.dirname(__file__), "hexagon.db")

def migrate_pearl():
    print(f"[Migration] Checking database schema at: {DB_PATH}")
    
    # 1. First run SQLAlchemy create_all to create any missing tables
    Base.metadata.create_all(bind=engine)
    print("  [+] SQLAlchemy create_all executed successfully.")

    # 2. Add columns to existing pearl_agents table if missing (SQLite doesn't alter tables automatically)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(pearl_agents)")
    existing_cols = {row[1] for row in cur.fetchall()}

    new_cols = [
        ("system_prompt", "TEXT"),
        ("greeting", "TEXT"),
        ("test_variables", "TEXT"), # JSON stored as TEXT in sqlite
        ("version", "INTEGER DEFAULT 1"),
    ]

    for col_name, col_type in new_cols:
        if col_name not in existing_cols:
            cur.execute(f"ALTER TABLE pearl_agents ADD COLUMN {col_name} {col_type}")
            print(f"  [+] Added pearl_agents.{col_name}")
        else:
            print(f"  · pearl_agents.{col_name} already exists")

    conn.commit()
    conn.close()
    print("[SUCCESS] Pearl migration completed.")

if __name__ == "__main__":
    migrate_pearl()
