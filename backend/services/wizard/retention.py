"""Transcript retention sweep.

Clears ``call_logs.transcript`` / ``ai_suggestions`` for rows older than the user's
``retention_days_transcript`` (integrations row; default 180 days; 0 = keep forever),
keeps the debrief, and never touches rows a Relay page links to. Audio is never stored
(``retention_days_audio`` is informational). Runs at startup (``CLOZFLOW_WIZARD_RETENTION_SWEEP``
≠ ``0``) and on demand via ``POST /api/wizard/admin/retention/run``.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import CallLog, User
from models_relay import Relay
from models_wizard import WizardIntegration

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 180
PURGED_MARKER = "[]"


def sweep_enabled_at_startup() -> bool:
    return (os.getenv("CLOZFLOW_WIZARD_RETENTION_SWEEP") or "1").strip().lower() not in ("0", "false", "no", "off")


def retention_days_for(db: Session, user_id: int) -> int:
    row = db.get(WizardIntegration, user_id)
    if row is None or row.retention_days_transcript is None:
        return DEFAULT_RETENTION_DAYS
    return max(0, int(row.retention_days_transcript))


def run_retention_sweep(db: Session, *, now: Optional[datetime] = None, user_id: Optional[int] = None) -> dict:
    """Purge transcripts past retention. Returns ``{users_checked, transcripts_cleared, skipped_relay, skipped_keep_forever}``."""
    now = now or datetime.utcnow()
    stats = {"users_checked": 0, "transcripts_cleared": 0, "skipped_relay": 0, "skipped_keep_forever": 0}
    user_ids = [user_id] if user_id is not None else [row[0] for row in db.execute(select(User.id)).all()]
    relay_call_ids = {row[0] for row in db.execute(select(Relay.call_id)).all() if row[0] is not None}
    for uid in user_ids:
        stats["users_checked"] += 1
        days = retention_days_for(db, uid)
        if days <= 0:
            stats["skipped_keep_forever"] += 1
            continue
        cutoff = now - timedelta(days=days)
        rows = (db.query(CallLog).filter(CallLog.user_id == uid, CallLog.timestamp.isnot(None), CallLog.timestamp < cutoff).all())
        for log in rows:
            if (log.transcript or PURGED_MARKER) == PURGED_MARKER and (log.ai_suggestions or PURGED_MARKER) == PURGED_MARKER:
                continue  # already purged (or never had content)
            if log.id in relay_call_ids:
                stats["skipped_relay"] += 1
                continue
            log.transcript = PURGED_MARKER
            log.ai_suggestions = PURGED_MARKER
            if hasattr(log, "metrics"):
                metrics = dict(log.metrics) if isinstance(log.metrics, dict) else {}
                metrics["transcript_purged_at"] = now.replace(microsecond=0).isoformat() + "Z"
                log.metrics = metrics
            stats["transcripts_cleared"] += 1
    if stats["transcripts_cleared"]:
        db.commit()
    logger.info("wizard retention sweep: %s", json.dumps(stats))
    return stats
