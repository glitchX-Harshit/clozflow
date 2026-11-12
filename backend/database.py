from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateColumn

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


def utc_isoformat(value: Optional[datetime]) -> Optional[str]:
    """Render a stored timestamp as ISO-8601 UTC with a ``Z`` suffix.

    Timestamps are stored as naive datetimes that are already UTC
    (``datetime.utcnow``). Clients parse a bare ISO string as *local* time, so
    API responses must say ``Z``. Aware datetimes are converted to UTC first.
    """
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.isoformat() + "Z"


# ── Startup schema migration ─────────────────────────────────────────────────
# Base.metadata.create_all() creates missing *tables* but never alters existing
# ones, so a column added to a model makes every query on an existing database
# fail with "no such column". add_missing_columns() closes that gap for the
# common case: a new nullable column. It runs on every start and is idempotent.

def add_missing_columns(bind=None, metadata=None) -> list:
    """Add model columns that are missing from existing tables.

    Only nullable, non-primary-key, non-unique columns are added automatically
    (anything else needs a hand-written migration and is reported instead).
    A scalar Python default (``Column(..., default=x)``) is back-filled into
    existing rows, and indexes that use the new column are created. Safe to run
    concurrently from several workers. Returns the ``"table.column"`` names added.
    """
    bind = bind if bind is not None else engine
    metadata = metadata if metadata is not None else Base.metadata
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    added = []
    for table in metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # create_all() creates it with every column
        present = {col["name"] for col in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present:
                continue
            if column.primary_key or not column.nullable or column.unique:
                print(f"[schema] WARNING: {table.name}.{column.name} is missing but is not a plain "
                      "nullable column; add it with a manual migration.")
                continue
            if _add_column(bind, table, column):
                added.append(f"{table.name}.{column.name}")
                print(f"[schema] Added missing column {table.name}.{column.name}")
    return added


def _add_column(bind, table, column) -> bool:
    dialect = bind.dialect
    column_ddl = str(CreateColumn(column).compile(dialect=dialect))
    if_not_exists = "IF NOT EXISTS " if dialect.name == "postgresql" else ""
    ddl = (f"ALTER TABLE {dialect.identifier_preparer.format_table(table)} "
           f"ADD COLUMN {if_not_exists}{column_ddl}")
    try:
        with bind.begin() as conn:
            conn.execute(text(ddl))
            default = column.default
            if default is not None and getattr(default, "is_scalar", False):
                conn.execute(table.update().where(column.is_(None)).values({column.name: default.arg}))
            for index in table.indexes:
                if column.name in index.columns:
                    index.create(bind=conn, checkfirst=True)
    except DBAPIError as exc:
        message = str(exc.orig if exc.orig is not None else exc).lower()
        if "duplicate column" in message or "already exists" in message:
            return False  # another worker added it first
        print(f"[schema] ERROR: could not add {table.name}.{column.name}: {type(exc.orig or exc).__name__}")
        return False
    return True
