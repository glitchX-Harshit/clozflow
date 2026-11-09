from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

import os
_default_db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "hexagon.db"))
SQLALCHEMY_DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{_default_db_path}")

# Render/Supabase may provide postgres:// but SQLAlchemy 1.4+ requires postgresql://
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {}
engine_kwargs = {}

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    # SQLite optimization for 10-25 concurrent calls:
    # 1. check_same_thread=False allows cross-thread async DB sessions
    # 2. timeout=30.0 waits up to 30s instead of throwing 'database is locked'
    connect_args["check_same_thread"] = False
    connect_args["timeout"] = 30.0
    engine_kwargs["connect_args"] = connect_args
else:
    # PostgreSQL / Supabase connection pool tuning for concurrent voice sessions
    engine_kwargs["pool_size"] = int(os.environ.get("DB_POOL_SIZE", "20"))
    engine_kwargs["max_overflow"] = int(os.environ.get("DB_MAX_OVERFLOW", "15"))
    engine_kwargs["pool_timeout"] = int(os.environ.get("DB_POOL_TIMEOUT", "30"))
    engine_kwargs["pool_recycle"] = int(os.environ.get("DB_POOL_RECYCLE", "1800"))
    engine_kwargs["pool_pre_ping"] = True

engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_kwargs)

# For SQLite, enable WAL (Write-Ahead Logging) mode to allow concurrent readers & writer
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()
        except Exception:
            pass

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
