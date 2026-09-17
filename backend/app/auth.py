"""Autenticacion de la tablet: Bearer token -> Device (hash, no login por persona)."""
from __future__ import annotations

import hashlib

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Device


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_device(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Device:
    """Bearer token -> Device. Falta, invalido o revocado -> 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": "unauthorized"})

    token = authorization[len("Bearer "):].strip()
    if not token:
        raise HTTPException(status_code=401, detail={"code": "unauthorized"})

    token_hash = hash_token(token)
    device = (
        db.query(Device)
        .filter(Device.token_hash == token_hash, Device.revoked_at.is_(None))
        .first()
    )
    if device is None:
        raise HTTPException(status_code=401, detail={"code": "unauthorized"})

    return device
