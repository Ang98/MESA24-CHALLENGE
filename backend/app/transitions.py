"""Tabla de transiciones + update condicional + evento, en una transaccion."""
from __future__ import annotations

from typing import NamedTuple

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app import clock
from app.models import EntryEvent, QueueEntry


class TransitionError(Exception):
    """Error de dominio; el router lo traduce a 404/409."""

    def __init__(self, code: str, status_code: int, current_status: str | None = None):
        self.code = code
        self.status_code = status_code
        self.current_status = current_status
        super().__init__(code)


def to_http_exception(exc: TransitionError) -> HTTPException:
    """Traduce un TransitionError al HTTPException que espera la spec."""
    if exc.status_code == 404:
        return HTTPException(status_code=404, detail={"code": "not_found"})
    return HTTPException(
        status_code=409,
        detail={"code": exc.code, "current_status": exc.current_status},
    )


class Transition(NamedTuple):
    from_statuses: tuple[str, ...]
    to_status: str
    event_type: str
    actor: str


# Nota tecnica / spec: tabla de transiciones.
TRANSITIONS: dict[str, Transition] = {
    "call": Transition(("waiting",), "called", "called", "device"),
    "seat": Transition(("waiting", "called"), "seated", "seated", "device"),
    "no_show": Transition(("called",), "no_show", "no_show", "device"),
    "remove": Transition(("waiting",), "removed", "removed", "device"),
    "cancel": Transition(("waiting", "called"), "cancelled", "cancelled", "customer"),
}


def _get_entry_in_location(db: Session, entry_id: int, location_id: int) -> QueueEntry | None:
    return (
        db.query(QueueEntry)
        .filter(QueueEntry.id == entry_id, QueueEntry.location_id == location_id)
        .first()
    )


def apply_transition(
    db: Session,
    *,
    entry_id: int,
    location_id: int,
    action: str,
    device_id: int | None = None,
) -> QueueEntry:
    """Ejecuta la transicion `action` sobre la entrada, si esta en un estado
    valido. Lanza TransitionError(404) si no existe en el local, o
    TransitionError(409, current_status=...) si la transicion no aplica."""
    transition = TRANSITIONS[action]

    entry = _get_entry_in_location(db, entry_id, location_id)
    if entry is None:
        raise TransitionError("not_found", 404)

    from_status = entry.status

    # Además del IN, se exige el estado leído: si otra tablet lo cambió entre la
    # lectura y el UPDATE, responde 409 en vez de guardar un from_status falso.
    result = db.execute(
        update(QueueEntry)
        .where(
            QueueEntry.id == entry_id,
            QueueEntry.location_id == location_id,
            QueueEntry.status.in_(transition.from_statuses),
            QueueEntry.status == from_status,
        )
        .values(status=transition.to_status)
    )

    if result.rowcount == 1:
        db.add(
            EntryEvent(
                entry_id=entry_id,
                location_id=location_id,
                type=transition.event_type,
                from_status=from_status,
                to_status=transition.to_status,
                actor=transition.actor,
                device_id=device_id,
                created_at=clock.now_utc(),
            )
        )
        db.commit()
        db.refresh(entry)
        return entry

    db.rollback()
    current = _get_entry_in_location(db, entry_id, location_id)
    current_status = current.status if current is not None else from_status
    raise TransitionError("invalid_transition", 409, current_status=current_status)


def _record_event_if_status(
    db: Session,
    *,
    entry_id: int,
    location_id: int,
    allowed: tuple[str, ...],
    event_type: str,
    actor: str,
    device_id: int | None,
) -> QueueEntry:
    """Evento que no cambia el estado. Igual que en las transiciones, lo decide
    un update condicional (SET status = status) y no la lectura en Python: si la
    tablet sienta en ese instante, responde 409 en vez de dejar un evento falso.
    rowcount cuenta filas encontradas aunque el valor no cambie (SQLite; en MySQL
    SQLAlchemy activa FOUND_ROWS por defecto)."""
    entry = _get_entry_in_location(db, entry_id, location_id)
    if entry is None:
        raise TransitionError("not_found", 404)

    status = entry.status
    result = db.execute(
        update(QueueEntry)
        .where(
            QueueEntry.id == entry_id,
            QueueEntry.location_id == location_id,
            QueueEntry.status.in_(allowed),
            QueueEntry.status == status,
        )
        .values(status=QueueEntry.status)
    )

    if result.rowcount == 1:
        db.add(
            EntryEvent(
                entry_id=entry_id,
                location_id=location_id,
                type=event_type,
                from_status=status,
                to_status=status,
                actor=actor,
                device_id=device_id,
                created_at=clock.now_utc(),
            )
        )
        db.commit()
        db.refresh(entry)
        return entry

    db.rollback()
    current = _get_entry_in_location(db, entry_id, location_id)
    current_status = current.status if current is not None else status
    raise TransitionError("invalid_transition", 409, current_status=current_status)


def apply_on_my_way(db: Session, *, entry_id: int, location_id: int) -> QueueEntry:
    """No cambia de estado; solo valido si status == called."""
    return _record_event_if_status(
        db,
        entry_id=entry_id,
        location_id=location_id,
        allowed=("called",),
        event_type="on_my_way",
        actor="customer",
        device_id=None,
    )


def apply_link_recovered(
    db: Session, *, entry_id: int, location_id: int, device_id: int
) -> QueueEntry:
    """No cambia de estado; solo valido si status en {waiting, called}."""
    return _record_event_if_status(
        db,
        entry_id=entry_id,
        location_id=location_id,
        allowed=("waiting", "called"),
        event_type="link_recovered",
        actor="device",
        device_id=device_id,
    )


def register_joined(db: Session, entry: QueueEntry) -> None:
    """Evento `joined` al crear la entrada (misma transaccion que el insert).
    Usa joined_at para que entrada y evento tengan la misma hora."""
    db.add(
        EntryEvent(
            entry_id=entry.id,
            location_id=entry.location_id,
            type="joined",
            from_status=None,
            to_status="waiting",
            actor="customer",
            device_id=None,
            created_at=entry.joined_at,
        )
    )
