"""Endpoints del comensal (sin auth)."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock, ratelimit, transitions
from app.config import get_settings
from app.db import get_db
from app.models import Location, QueueEntry
from app.phones import sms_supported
from app.queue import position_and_wait
from app.schemas import EntryPublic, JoinEntryRequest, LocationPublic
from app.service_date import service_date_for
from app.transitions import TransitionError

router = APIRouter(prefix="/api", tags=["public"])


def entry_public_payload(db: Session, entry: QueueEntry, location: Location) -> dict:
    ahead, position, wait_min = position_and_wait(db, entry, location.minutes_per_party)
    return {
        "public_token": entry.public_token,
        "status": entry.status,
        "name": entry.name,
        "phone": entry.phone_e164,
        "party_size": entry.party_size,
        "location": {"slug": location.slug, "name": location.name},
        "groups_ahead": ahead,
        "position": position,
        "wait_min": wait_min,
        "sms_supported": sms_supported(entry.phone_e164),
        "joined_at": clock.to_iso_z(entry.joined_at),
    }


def _get_location_or_404(db: Session, slug: str) -> Location:
    location = db.query(Location).filter(Location.slug == slug).first()
    if location is None:
        raise HTTPException(status_code=404, detail={"code": "not_found"})
    return location


def _get_entry_by_token_or_404(db: Session, public_token: str) -> QueueEntry:
    entry = db.query(QueueEntry).filter(QueueEntry.public_token == public_token).first()
    if entry is None:
        raise HTTPException(status_code=404, detail={"code": "not_found"})
    return entry


@router.get("/locations/{slug}", response_model=LocationPublic)
def get_location(slug: str, db: Session = Depends(get_db)):
    location = _get_location_or_404(db, slug)
    return {"slug": location.slug, "name": location.name}


@router.post("/locations/{slug}/entries")
def join_queue(
    slug: str,
    body: JoinEntryRequest,
    request: Request,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=100),
    db: Session = Depends(get_db),
):
    settings = get_settings()

    # 1. El body ya fue validado por pydantic (422 si no cumple). Buscamos el local.
    location = _get_location_or_404(db, slug)

    # 2. Doble toque: se busca por idempotency_key ANTES de la regla de duplicados
    #    y del rate limit, para no perder el turno si el comensal toco dos veces.
    existing = (
        db.query(QueueEntry)
        .filter(QueueEntry.location_id == location.id, QueueEntry.idempotency_key == idempotency_key)
        .first()
    )
    if existing is not None:
        return JSONResponse(status_code=200, content=entry_public_payload(db, existing, location))

    # 3. Rate limit por IP+local y por telefono+local.
    ip = ratelimit.client_ip(request, settings.trusted_proxy_hops)
    retry_after = ratelimit.hit(("ip", location.id, ip), settings.rate_ip_max, settings.rate_ip_window_s)
    if retry_after is None:
        retry_after = ratelimit.hit(
            ("phone", location.id, body.phone), settings.rate_phone_max, settings.rate_phone_window_s
        )
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited"},
            headers={"Retry-After": str(retry_after)},
        )

    # 4. Insertar entrada + evento joined en una transaccion.
    # Un solo reloj para joined_at, consent_at y service_date: leerlo dos veces
    # podría dejarlos en días distintos justo a la hora de corte.
    now = clock.now_utc()
    today = service_date_for(now, location.timezone, settings.service_day_cutoff_hour)
    entry = QueueEntry(
        public_token=secrets.token_urlsafe(16),
        location_id=location.id,
        service_date=today,
        name=body.name,
        phone_e164=body.phone,
        party_size=body.party_size,
        status="waiting",
        joined_at=now,
        consent_at=now,
        idempotency_key=idempotency_key,
    )
    try:
        db.add(entry)
        db.flush()
    except IntegrityError:
        db.rollback()
        # 5. Choco con un indice unico: idempotency_key duplicada (doble toque
        #    simultaneo, se recupera el turno) o telefono duplicado (409).
        existing = (
            db.query(QueueEntry)
            .filter(QueueEntry.location_id == location.id, QueueEntry.idempotency_key == idempotency_key)
            .first()
        )
        if existing is not None:
            return JSONResponse(status_code=200, content=entry_public_payload(db, existing, location))
        raise HTTPException(status_code=409, detail={"code": "already_in_queue"})

    transitions.register_joined(db, entry)
    db.commit()
    db.refresh(entry)

    # 6. Alta correcta.
    return JSONResponse(status_code=201, content=entry_public_payload(db, entry, location))


@router.get("/entries/{public_token}", response_model=EntryPublic)
def get_entry(public_token: str, db: Session = Depends(get_db)):
    entry = _get_entry_by_token_or_404(db, public_token)
    return entry_public_payload(db, entry, entry.location)


@router.post("/entries/{public_token}/on-my-way", response_model=EntryPublic)
def on_my_way(public_token: str, db: Session = Depends(get_db)):
    entry = _get_entry_by_token_or_404(db, public_token)
    try:
        entry = transitions.apply_on_my_way(db, entry_id=entry.id, location_id=entry.location_id)
    except TransitionError as exc:
        raise transitions.to_http_exception(exc)
    return entry_public_payload(db, entry, entry.location)


@router.post("/entries/{public_token}/cancel", response_model=EntryPublic)
def cancel_entry(public_token: str, db: Session = Depends(get_db)):
    entry = _get_entry_by_token_or_404(db, public_token)
    try:
        entry = transitions.apply_transition(
            db, entry_id=entry.id, location_id=entry.location_id, action="cancel"
        )
    except TransitionError as exc:
        raise transitions.to_http_exception(exc)
    return entry_public_payload(db, entry, entry.location)
