"""Reporte diario (nota tecnica seccion 4)."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.models import EntryEvent, Location, QueueEntry


def build_report(db: Session, location: Location, report_date: date, today: date) -> dict:
    entries = (
        db.query(QueueEntry)
        .filter(QueueEntry.location_id == location.id, QueueEntry.service_date == report_date)
        .all()
    )

    joined = len(entries)
    seated = sum(1 for e in entries if e.status == "seated")
    no_show = sum(1 for e in entries if e.status == "no_show")
    removed = sum(1 for e in entries if e.status == "removed")
    cancelled = sum(1 for e in entries if e.status == "cancelled")
    waiting = sum(1 for e in entries if e.status == "waiting")
    called = sum(1 for e in entries if e.status == "called")

    is_today = report_date == today
    is_past = report_date < today

    left = cancelled + (waiting if is_past else 0)
    unclosed = called if is_past else 0
    in_progress = 0 if is_past else (waiting + called)

    avg_wait_min: float | None = None
    seated_ids = [e.id for e in entries if e.status == "seated"]
    if seated_ids:
        joined_at_by_id = {e.id: e.joined_at for e in entries}
        seated_events = (
            db.query(EntryEvent)
            .filter(EntryEvent.entry_id.in_(seated_ids), EntryEvent.type == "seated")
            .all()
        )
        diffs_min = []
        for ev in seated_events:
            joined_at = joined_at_by_id.get(ev.entry_id)
            if joined_at is not None:
                diffs_min.append((ev.created_at - joined_at).total_seconds() / 60.0)
        if diffs_min:
            avg_wait_min = round(sum(diffs_min) / len(diffs_min), 1)

    return {
        "date": report_date.isoformat(),
        "is_today": is_today,
        "joined": joined,
        "seated": seated,
        "left": left,
        "no_show": no_show,
        "unclosed": unclosed,
        "in_progress": in_progress,
        "removed": removed,
        "avg_wait_min": avg_wait_min,
    }
