"""Caso 11: rate limit por telefono, por IP y por local; X-Forwarded-For con
TRUSTED_PROXY_HOPS=1 no se evade cambiando el primer valor."""
from __future__ import annotations

from tests.conftest import join, unique_phone


def test_rate_limit_by_phone_blocks_on_max_plus_one(env, monkeypatch):
    monkeypatch.setenv("RATE_PHONE_MAX", "2")
    monkeypatch.setenv("RATE_IP_MAX", "100000")
    slug = env.lima_slug
    phone = unique_phone()

    r1 = join(env.client, slug, phone=phone, idem_key="rl-phone-1")
    assert r1.status_code == 201

    # Duplicado (mismo telefono, mismo dia); igual cuenta para el rate limit.
    r2 = join(env.client, slug, phone=phone, idem_key="rl-phone-2")
    assert r2.status_code == 409

    # Tercer intento = RATE_PHONE_MAX (2) + 1 -> 429 con Retry-After.
    r3 = join(env.client, slug, phone=phone, idem_key="rl-phone-3")
    assert r3.status_code == 429
    assert r3.json()["detail"]["code"] == "rate_limited"
    assert "Retry-After" in r3.headers

    # El limite es por telefono + local: el mismo telefono en otro local entra.
    other_location = join(env.client, env.santiago_slug, phone=phone, idem_key="rl-phone-other-loc")
    assert other_location.status_code == 201


def test_rate_limit_by_ip_is_per_location(env, monkeypatch):
    monkeypatch.setenv("RATE_IP_MAX", "2")
    monkeypatch.setenv("RATE_PHONE_MAX", "100000")

    for i in range(2):
        resp = join(env.client, env.lima_slug, phone=unique_phone(), idem_key=f"rl-ip-key-{i}")
        assert resp.status_code == 201

    # Tercer intento de la misma IP en el mismo local -> 429.
    blocked = join(env.client, env.lima_slug, phone=unique_phone(), idem_key="rl-ip-key-blocked")
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["code"] == "rate_limited"

    # Misma IP (TestClient), pero en otro local -> no esta bloqueada.
    other_location = join(env.client, env.santiago_slug, phone=unique_phone(), idem_key="rl-ip-key-other-loc")
    assert other_location.status_code == 201


def test_rate_limit_ip_uses_last_forwarded_hop_not_first(env, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    monkeypatch.setenv("RATE_IP_MAX", "2")
    monkeypatch.setenv("RATE_PHONE_MAX", "100000")
    real_ip = "5.5.5.5"

    for i in range(2):
        headers = {"X-Forwarded-For": f"{i}.{i}.{i}.{i}, {real_ip}"}
        resp = join(
            env.client,
            env.lima_slug,
            phone=unique_phone(),
            idem_key=f"rl-xff-{i}",
            extra_headers=headers,
        )
        assert resp.status_code == 201

    # Cambiar el primer valor (el que pondria el cliente) no evade el limite:
    # con TRUSTED_PROXY_HOPS=1 se usa el ultimo valor, que sigue siendo el mismo.
    headers = {"X-Forwarded-For": f"99.99.99.99, {real_ip}"}
    blocked = join(
        env.client, env.lima_slug, phone=unique_phone(), idem_key="rl-xff-blocked", extra_headers=headers
    )
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["code"] == "rate_limited"

    # Otra IP real (el valor de la derecha) no esta bloqueada: la IP se lee del header.
    headers = {"X-Forwarded-For": "99.99.99.99, 6.6.6.6"}
    other_ip = join(
        env.client, env.lima_slug, phone=unique_phone(), idem_key="rl-xff-other-ip", extra_headers=headers
    )
    assert other_ip.status_code == 201
