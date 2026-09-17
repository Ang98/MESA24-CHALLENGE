"""Fixtures y utilidades compartidas por los tests del backend.

Notas sobre como se sobreescribe cada pieza (indicadas por quien implemento el
backend):
- Reloj: se monkeypatchea `app.clock.now_utc` (todos los modulos lo llaman via
  `from app import clock`).
- Base de datos: `DATABASE_URL` se cambia con monkeypatch.setenv y se llama a
  `app.db.create_all()`; `app.db.get_engine()` reconstruye el engine solo.
- Rate limit: `app.ratelimit.reset()` al principio y al final de cada test; los
  limites (`RATE_IP_MAX`/`RATE_PHONE_MAX`) se ponen altos por defecto para que
  no interfieran con tests que no son de rate limit (test_ratelimit.py los baja
  explicitamente).
- Notificador: se inyecta un `FakeNotifier` con `app.dependency_overrides`.
- Locales y dispositivos: se crean directamente con los modelos.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

# `app` se importa gracias a `pythonpath = .` en pytest.ini.
from app import clock, ratelimit
from app.auth import hash_token
from app.db import create_all, get_session_factory
from app.main import app
from app.models import Device, EntryEvent, Location, QueueEntry
from app.notifier import FakeNotifier, get_notifier

# Hora fija de referencia para todos los tests (UTC naive). Lima esta en
# UTC-5 todo el ano (sin horario de verano), asi que 15:00 UTC = 10:00 local,
# claramente despues del corte de las 05:00.
FIXED_NOW = datetime(2024, 6, 10, 15, 0, 0)

LIMA_MINUTES_PER_PARTY = 10


# --------------------------------------------------------------------------
# Reloj congelado y controlable
# --------------------------------------------------------------------------
class ClockController:
    def __init__(self, start: datetime) -> None:
        self._now = start

    @property
    def now(self) -> datetime:
        return self._now

    def set(self, dt: datetime) -> None:
        self._now = dt

    def advance(self, **kwargs) -> None:
        self._now += timedelta(**kwargs)


@pytest.fixture
def frozen_clock(monkeypatch):
    controller = ClockController(FIXED_NOW)
    monkeypatch.setattr(clock, "now_utc", lambda: controller.now)
    return controller


# --------------------------------------------------------------------------
# Base de datos + rate limit
# --------------------------------------------------------------------------
@pytest.fixture
def db_env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    # Limites altos por defecto: los tests que no son de rate limit no deben
    # verse bloqueados por el (los propios tests de rate limit los bajan).
    monkeypatch.setenv("RATE_IP_MAX", "100000")
    monkeypatch.setenv("RATE_PHONE_MAX", "100000")
    create_all()
    ratelimit.reset()
    yield
    ratelimit.reset()


@pytest.fixture
def fake_notifier():
    notifier = FakeNotifier()
    app.dependency_overrides[get_notifier] = lambda: notifier
    yield notifier
    app.dependency_overrides.pop(get_notifier, None)


@pytest.fixture
def env(db_env, frozen_clock, fake_notifier):
    """Entorno completo de test: cliente + 2 locales + dispositivos + reloj."""
    session_factory = get_session_factory()
    db = session_factory()

    lima = Location(
        slug="demo-lima",
        name="Demo Lima",
        timezone="America/Lima",
        minutes_per_party=LIMA_MINUTES_PER_PARTY,
    )
    santiago = Location(
        slug="demo-santiago",
        name="Demo Santiago",
        timezone="America/Santiago",
        minutes_per_party=15,
    )
    db.add_all([lima, santiago])
    db.flush()

    token_lima_a = "token-lima-a"
    token_lima_b = "token-lima-b"
    token_santiago = "token-santiago"
    token_revoked = "token-revoked"

    db.add_all(
        [
            Device(location_id=lima.id, name="Puerta 1", token_hash=hash_token(token_lima_a)),
            Device(location_id=lima.id, name="Puerta 2", token_hash=hash_token(token_lima_b)),
            Device(location_id=santiago.id, name="Puerta 1", token_hash=hash_token(token_santiago)),
            Device(
                location_id=lima.id,
                name="Vieja",
                token_hash=hash_token(token_revoked),
                revoked_at=FIXED_NOW,
            ),
        ]
    )
    db.commit()

    ids = SimpleNamespace(
        lima_id=lima.id,
        santiago_id=santiago.id,
        lima_slug=lima.slug,
        santiago_slug=santiago.slug,
        lima_minutes_per_party=lima.minutes_per_party,
        token_lima_a=token_lima_a,
        token_lima_b=token_lima_b,
        token_santiago=token_santiago,
        token_revoked=token_revoked,
    )
    db.close()

    with TestClient(app) as client:
        yield SimpleNamespace(client=client, notifier=fake_notifier, clock=frozen_clock, **vars(ids))


# --------------------------------------------------------------------------
# Helpers de dominio (usados desde los distintos test_*.py)
# --------------------------------------------------------------------------
def unique_phone(prefix: str = "+51") -> str:
    return prefix + "".join(secrets.choice("0123456789") for _ in range(9))


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def join(
    client,
    slug: str,
    *,
    name: str = "Ana",
    phone: str | None = None,
    party_size: int = 2,
    consent: bool = True,
    idem_key: str | None = None,
    extra_headers: dict | None = None,
):
    """POST /api/locations/{slug}/entries con defaults razonables."""
    phone = phone if phone is not None else unique_phone()
    idem_key = idem_key or secrets.token_hex(8)
    headers = {"Idempotency-Key": idem_key}
    if extra_headers:
        headers.update(extra_headers)
    body = {"name": name, "phone": phone, "party_size": party_size, "consent": consent}
    return client.post(f"/api/locations/{slug}/entries", json=body, headers=headers)


def make_entry(client, slug: str, **kwargs) -> dict:
    """Como `join`, pero exige 201 y devuelve el JSON de la entrada creada."""
    resp = join(client, slug, **kwargs)
    assert resp.status_code == 201, resp.text
    return resp.json()


def get_entry_id(public_token: str) -> int:
    session_factory = get_session_factory()
    db = session_factory()
    try:
        entry = db.query(QueueEntry).filter(QueueEntry.public_token == public_token).first()
        assert entry is not None
        return entry.id
    finally:
        db.close()


def get_status(entry_id: int) -> str:
    session_factory = get_session_factory()
    db = session_factory()
    try:
        entry = db.query(QueueEntry).filter(QueueEntry.id == entry_id).first()
        assert entry is not None
        return entry.status
    finally:
        db.close()


def all_events(entry_id: int) -> list[EntryEvent]:
    session_factory = get_session_factory()
    db = session_factory()
    try:
        return (
            db.query(EntryEvent)
            .filter(EntryEvent.entry_id == entry_id)
            .order_by(EntryEvent.id)
            .all()
        )
    finally:
        db.close()


def last_event(entry_id: int) -> EntryEvent:
    return all_events(entry_id)[-1]


def device_id_for_token(raw_token: str) -> int:
    session_factory = get_session_factory()
    db = session_factory()
    try:
        device = db.query(Device).filter(Device.token_hash == hash_token(raw_token)).first()
        assert device is not None
        return device.id
    finally:
        db.close()


def move_to_status(client, slug: str, device_token: str, target: str, *, phone: str | None = None) -> dict:
    """Crea una entrada nueva y la lleva al estado `target` via API real."""
    entry = make_entry(client, slug, phone=phone)
    token = entry["public_token"]
    entry_id = get_entry_id(token)
    headers = auth_headers(device_token)

    if target == "waiting":
        pass
    elif target == "called":
        resp = client.post(f"/api/tablet/entries/{entry_id}/call", headers=headers)
        assert resp.status_code == 200, resp.text
    elif target == "seated":
        resp = client.post(f"/api/tablet/entries/{entry_id}/seat", headers=headers)
        assert resp.status_code == 200, resp.text
    elif target == "no_show":
        resp = client.post(f"/api/tablet/entries/{entry_id}/call", headers=headers)
        assert resp.status_code == 200, resp.text
        resp = client.post(f"/api/tablet/entries/{entry_id}/no-show", headers=headers)
        assert resp.status_code == 200, resp.text
    elif target == "removed":
        resp = client.post(f"/api/tablet/entries/{entry_id}/remove", headers=headers)
        assert resp.status_code == 200, resp.text
    elif target == "cancelled":
        resp = client.post(f"/api/entries/{token}/cancel")
        assert resp.status_code == 200, resp.text
    else:
        raise ValueError(f"estado desconocido: {target}")

    return {"entry_id": entry_id, "public_token": token}
