"""Endpoints del anfitrion (tablet), autenticados con Bearer token."""
from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import clock, transitions
from app.auth import get_device
from app.config import get_settings
from app.db import get_db
from app.models import Device, EntryEvent, QueueEntry
from app.notifier import Notifier, get_notifier
from app.phones import last3, sms_supported
from app.report import build_report
from app.schemas import RecoverLinkResponse, ReportResponse, TabletQueueItem, TabletQueueResponse
from app.service_date import today_for_location
from app.transitions import TransitionError

router = APIRouter(prefix="/api/tablet", tags=["tablet"])


def _item_payload(entry: QueueEntry, on_my_way: bool) -> dict:
    return {
        "id": entry.id,
        "name": entry.name,
        "party_size": entry.party_size,
        "status": entry.status,
        "joined_at": clock.to_iso_z(entry.joined_at),
        "phone_last3": last3(entry.phone_e164),
        "on_my_way": on_my_way,
    }


def tablet_item_payload(db: Session, entry: QueueEntry) -> dict:
    has_on_my_way = (
        db.query(EntryEvent.id)
        .filter(EntryEvent.entry_id == entry.id, EntryEvent.type == "on_my_way")
        .first()
        is not None
    )
    return _item_payload(entry, has_on_my_way)


def _apply_or_error(
    db: Session, *, entry_id: int, location_id: int, action: str, device_id: int
) -> QueueEntry:
    try:
        return transitions.apply_transition(
            db, entry_id=entry_id, location_id=location_id, action=action, device_id=device_id
        )
    except TransitionError as exc:
        raise transitions.to_http_exception(exc)


@router.get("/queue", response_model=TabletQueueResponse)
def get_queue(device: Device = Depends(get_device), db: Session = Depends(get_db)):
    settings = get_settings()
    location = device.location
    today = today_for_location(location.timezone, settings.service_day_cutoff_hour)

    entries = (
        db.query(QueueEntry)
        .filter(
            QueueEntry.location_id == location.id,
            QueueEntry.service_date == today,
            QueueEntry.status.in_(["waiting", "called"]),
        )
        .order_by(QueueEntry.joined_at, QueueEntry.id)
        .all()
    )

    on_my_way_ids: set[int] = set()
    entry_ids = [e.id for e in entries]
    if entry_ids:
        rows = (
            db.query(EntryEvent.entry_id)
            .filter(EntryEvent.entry_id.in_(entry_ids), EntryEvent.type == "on_my_way")
            .distinct()
            .all()
        )
        on_my_way_ids = {row[0] for row in rows}

    return {
        "location": {"slug": location.slug, "name": location.name},
        "server_time": clock.to_iso_z(clock.now_utc()),
        "entries": [_item_payload(e, e.id in on_my_way_ids) for e in entries],
    }


@router.post("/entries/{entry_id}/call", response_model=TabletQueueItem)
def call_entry(
    entry_id: int,
    device: Device = Depends(get_device),
    db: Session = Depends(get_db),
    notifier: Notifier = Depends(get_notifier),
):
    entry = _apply_or_error(
        db, entry_id=entry_id, location_id=device.location_id, action="call", device_id=device.id
    )
    # Notificacion despues del commit, y solo a Peru y Chile (nota tecnica §7).
    if sms_supported(entry.phone_e164):
        notifier.notify_called(entry)
    return tablet_item_payload(db, entry)


@router.post("/entries/{entry_id}/seat", response_model=TabletQueueItem)
def seat_entry(entry_id: int, device: Device = Depends(get_device), db: Session = Depends(get_db)):
    entry = _apply_or_error(
        db, entry_id=entry_id, location_id=device.location_id, action="seat", device_id=device.id
    )
    return tablet_item_payload(db, entry)


@router.post("/entries/{entry_id}/no-show", response_model=TabletQueueItem)
def no_show_entry(entry_id: int, device: Device = Depends(get_device), db: Session = Depends(get_db)):
    entry = _apply_or_error(
        db, entry_id=entry_id, location_id=device.location_id, action="no_show", device_id=device.id
    )
    return tablet_item_payload(db, entry)


@router.post("/entries/{entry_id}/remove", response_model=TabletQueueItem)
def remove_entry(entry_id: int, device: Device = Depends(get_device), db: Session = Depends(get_db)):
    entry = _apply_or_error(
        db, entry_id=entry_id, location_id=device.location_id, action="remove", device_id=device.id
    )
    return tablet_item_payload(db, entry)


@router.post("/entries/{entry_id}/recover-link", response_model=RecoverLinkResponse)
def recover_link(entry_id: int, device: Device = Depends(get_device), db: Session = Depends(get_db)):
    settings = get_settings()
    try:
        entry = transitions.apply_link_recovered(
            db, entry_id=entry_id, location_id=device.location_id, device_id=device.id
        )
    except TransitionError as exc:
        raise transitions.to_http_exception(exc)
    return {"url": f"{settings.public_base_url}/t/{entry.public_token}"}


@router.get("/report", response_model=ReportResponse)
def get_report(
    date: str | None = None,
    device: Device = Depends(get_device),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    location = device.location
    today = today_for_location(location.timezone, settings.service_day_cutoff_hour)

    if date is None:
        report_date = today
    else:
        try:
            report_date = date_type.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=422, detail={"code": "invalid_date"})

    return build_report(db, location, report_date, today)
