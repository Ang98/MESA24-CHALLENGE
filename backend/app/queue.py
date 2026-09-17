"""Puesto en la cola y rango de tiempo estimado (nota tecnica seccion 3)."""
from __future__ import annotations

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models import QueueEntry


def groups_ahead(db: Session, entry: QueueEntry) -> int:
    """Cantidad de entradas en waiting del mismo local/dia, antes que esta
    (desempate por id, nunca por el orden natural de insercion)."""
    return (
        db.query(func.count(QueueEntry.id))
        .filter(
            QueueEntry.location_id == entry.location_id,
            QueueEntry.service_date == entry.service_date,
            QueueEntry.status == "waiting",
            or_(
                QueueEntry.joined_at < entry.joined_at,
                and_(QueueEntry.joined_at == entry.joined_at, QueueEntry.id < entry.id),
            ),
        )
        .scalar()
        or 0
    )


def position_and_wait(
    db: Session, entry: QueueEntry, minutes_per_party: int
) -> tuple[int | None, int | None, list[int] | None]:
    """Devuelve (groups_ahead, position, wait_min). Solo tiene valores para
    entradas en waiting; para el resto de estados, los tres son None."""
    if entry.status != "waiting":
        return None, None, None

    ahead = groups_ahead(db, entry)
    position = ahead + 1
    if position > 3:
        position = None
    wait_min = [ahead * minutes_per_party, (ahead + 1) * minutes_per_party]
    return ahead, position, wait_min
