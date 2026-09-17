"""Casos 4, 5 y 6 de la especificacion: duplicados, idempotencia y 422."""
from __future__ import annotations

from app import ratelimit
from app.db import get_session_factory
from app.models import QueueEntry
from app.service_date import service_date_for
from tests.conftest import join, unique_phone


# --- Caso 4: duplicados --------------------------------------------------
def test_duplicate_phone_same_day_then_allowed_after_cancel_and_next_day(env):
    slug = env.lima_slug
    phone = unique_phone()

    r1 = join(env.client, slug, phone=phone, idem_key="dup-key-1")
    assert r1.status_code == 201
    token1 = r1.json()["public_token"]

    # Mismo telefono, mismo local y dia, otra clave -> 409 sin token.
    r2 = join(env.client, slug, phone=phone, idem_key="dup-key-2")
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "already_in_queue"
    # El token no debe aparecer en ningun nivel de la respuesta.
    assert "public_token" not in r2.text
    assert token1 not in r2.text

    # Tras cancelar el primero -> permitido.
    cancel_resp = env.client.post(f"/api/entries/{token1}/cancel")
    assert cancel_resp.status_code == 200
    r3 = join(env.client, slug, phone=phone, idem_key="dup-key-3")
    assert r3.status_code == 201

    # Al dia de servicio siguiente -> permitido (aunque r3 siga en waiting).
    env.clock.advance(hours=24)
    r4 = join(env.client, slug, phone=phone, idem_key="dup-key-4")
    assert r4.status_code == 201

    # Mismo telefono en otro local -> permitido.
    r5 = join(env.client, env.santiago_slug, phone=phone, idem_key="dup-key-5")
    assert r5.status_code == 201


# --- Caso 5: idempotencia -------------------------------------------------
def test_idempotency_same_key_returns_same_entry_and_single_row(env):
    slug = env.lima_slug
    key = "same-idem-key"
    phone = unique_phone()

    r1 = join(env.client, slug, phone=phone, idem_key=key)
    assert r1.status_code == 201
    token1 = r1.json()["public_token"]

    r2 = join(env.client, slug, phone=phone, idem_key=key)
    assert r2.status_code == 200
    assert r2.json()["public_token"] == token1

    session_factory = get_session_factory()
    db = session_factory()
    try:
        count = (
            db.query(QueueEntry)
            .filter(QueueEntry.location_id == env.lima_id, QueueEntry.idempotency_key == key)
            .count()
        )
        assert count == 1
    finally:
        db.close()


def test_idempotency_replay_does_not_consume_rate_limit(env, monkeypatch):
    # La clave se busca antes del rate limit: un doble toque no gasta intentos.
    monkeypatch.setenv("RATE_PHONE_MAX", "1")
    phone = unique_phone()

    assert join(env.client, env.lima_slug, phone=phone, idem_key="replay-key").status_code == 201
    assert join(env.client, env.lima_slug, phone=phone, idem_key="replay-key").status_code == 200


def test_simultaneous_double_tap_returns_the_other_tap_entry(env, monkeypatch):
    # El otro toque hace commit justo entre la busqueda por clave y el insert
    # (se cuela en el rate limit). El insert choca y se recupera ese turno.
    phone = unique_phone()
    key = "double-tap-key"
    other = {}
    original_hit = ratelimit.hit

    def hit_and_let_other_tap_commit(*args, **kwargs):
        if not other:
            other_db = get_session_factory()()
            try:
                entry = QueueEntry(
                    public_token="other-tap-token",
                    location_id=env.lima_id,
                    service_date=service_date_for(env.clock.now, "America/Lima", 5),
                    name="Ana",
                    phone_e164=phone,
                    party_size=2,
                    status="waiting",
                    joined_at=env.clock.now,
                    consent_at=env.clock.now,
                    idempotency_key=key,
                )
                other_db.add(entry)
                other_db.commit()
                other["token"] = entry.public_token
            finally:
                other_db.close()
        return original_hit(*args, **kwargs)

    monkeypatch.setattr(ratelimit, "hit", hit_and_let_other_tap_commit)

    resp = join(env.client, env.lima_slug, phone=phone, idem_key=key)
    assert resp.status_code == 200
    assert resp.json()["public_token"] == other["token"]


def test_idempotency_missing_header_422(env):
    resp = env.client.post(
        f"/api/locations/{env.lima_slug}/entries",
        json={"name": "Ana", "phone": unique_phone(), "party_size": 2, "consent": True},
        # sin header Idempotency-Key
    )
    assert resp.status_code == 422


# --- Caso 6: validacion 422 -------------------------------------------------
def test_join_without_consent_422(env):
    resp = env.client.post(
        f"/api/locations/{env.lima_slug}/entries",
        json={"name": "Ana", "phone": unique_phone(), "party_size": 2, "consent": False},
        headers={"Idempotency-Key": "consent-false-key"},
    )
    assert resp.status_code == 422


def test_join_invalid_phone_422(env):
    resp = env.client.post(
        f"/api/locations/{env.lima_slug}/entries",
        json={"name": "Ana", "phone": "12345", "party_size": 2, "consent": True},
        headers={"Idempotency-Key": "invalid-phone-key"},
    )
    assert resp.status_code == 422
