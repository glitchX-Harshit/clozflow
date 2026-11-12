"""Startup migration: add_missing_columns() upgrades existing databases."""
from sqlalchemy import Boolean, Column, Integer, MetaData, String, Table, Text, create_engine, inspect, text
from sqlalchemy.orm import Session

import models  # noqa: F401
from database import Base, add_missing_columns
from models import User


def test_adds_missing_nullable_columns_once(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name VARCHAR)"))
        conn.execute(text("INSERT INTO widgets (id, name) VALUES (1, 'existing row')"))

    metadata = MetaData()
    Table(
        "widgets", metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String),
        Column("notes", Text, nullable=True),
        Column("enabled", Boolean, default=True),
        Column("code", String, index=True),
        Column("required", String, nullable=False),   # needs a manual migration
        Column("slug", String, unique=True),          # needs a manual migration
    )
    Table("brand_new", metadata, Column("id", Integer, primary_key=True))  # left to create_all

    added = add_missing_columns(engine, metadata)
    assert sorted(added) == ["widgets.code", "widgets.enabled", "widgets.notes"]

    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("widgets")}
    assert {"notes", "enabled", "code"} <= columns and not {"required", "slug"} & columns
    assert "ix_widgets_code" in {ix["name"] for ix in inspector.get_indexes("widgets")}
    assert "brand_new" not in inspector.get_table_names()
    with engine.connect() as conn:
        assert conn.execute(text("SELECT enabled, notes FROM widgets WHERE id = 1")).one() == (1, None)

    assert add_missing_columns(engine, metadata) == []  # idempotent
    engine.dispose()


def test_existing_users_table_gets_ai_override_prompt(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'users.db').as_posix()}")
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:  # an older database, before the column existed
        conn.execute(text("ALTER TABLE users DROP COLUMN ai_override_prompt"))
        conn.execute(text("INSERT INTO users (id, email, password_hash) VALUES (1, 'old@example.com', 'x')"))

    assert "users.ai_override_prompt" in add_missing_columns(engine)
    with Session(engine) as db:
        user = db.get(User, 1)
        assert user.ai_override_prompt is None
        user.ai_override_prompt = "Mention the free pilot."
        db.commit()
    engine.dispose()
