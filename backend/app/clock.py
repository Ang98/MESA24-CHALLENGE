"""Reloj centralizado para poder monkeypatchear la hora en los tests."""
from __future__ import annotations

from datetime import datetime, timezone


def now_utc() -> datetime:
    """Devuelve la hora actual en UTC como datetime naive (sin tzinfo)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_iso_z(dt: datetime) -> str:
    """Serializa un datetime naive UTC a ISO 8601 con sufijo Z."""
    return dt.isoformat() + "Z"
