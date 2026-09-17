"""Casos 8 y 9 de la especificacion: auth/local de la tablet y ocultamiento de
datos sensibles en la cola."""
from __future__ import annotations

import pytest

from tests.conftest import (
    all_events,
    auth_headers,
    device_id_for_token,
    get_entry_id,
    make_entry,
    move_to_status,
)


# --- Caso 8 ----------------------------------------------------------------
def test_tablet_actions_on_entry_from_other_location_404(env):
    entry = make_entry(env.client, env.lima_slug)
    entry_id = get_entry_id(entry["public_token"])
    headers_other_location = auth_headers(env.token_santiago)

    for path in ("call", "seat", "no-show", "remove", "recover-link"):
        resp = env.client.post(f"/api/tablet/entries/{entry_id}/{path}", headers=headers_other_location)
        assert resp.status_code == 404, f"{path}: {resp.status_code} {resp.text}"


def test_tablet_invalid_or_revoked_token_401(env):
    resp = env.client.get("/api/tablet/queue", headers=auth_headers("token-inexistente"))
    assert resp.status_code == 401

    resp = env.client.get("/api/tablet/queue", headers=auth_headers(env.token_revoked))
    assert resp.status_code == 401

    resp = env.client.get("/api/tablet/queue")  # sin header Authorization
    assert resp.status_code == 401


# --- Caso 9 ------------------------------------------------------------
def test_tablet_queue_hides_public_token_and_full_phone(env):
    entry = make_entry(env.client, env.lima_slug, phone="+51987654321")
    entry_id = get_entry_id(entry["public_token"])

    resp = env.client.get("/api/tablet/queue", headers=auth_headers(env.token_lima_a))
    assert resp.status_code == 200
    item = next(e for e in resp.json()["entries"] if e["id"] == entry_id)

    assert item["phone_last3"] == "321"
    # Ni el token ni el telefono completo aparecen en ninguna parte de la respuesta.
    assert entry["public_token"] not in resp.text
    assert "+51987654321" not in resp.text
    assert "987654321" not in resp.text


def test_recover_link_returns_url_and_registers_event_with_device(env):
    entry = make_entry(env.client, env.lima_slug)
    entry_id = get_entry_id(entry["public_token"])
    device_id = device_id_for_token(env.token_lima_a)

    resp = env.client.post(
        f"/api/tablet/entries/{entry_id}/recover-link", headers=auth_headers(env.token_lima_a)
    )
    assert resp.status_code == 200
    assert resp.json()["url"].endswith(f"/t/{entry['public_token']}")

    recovered = [e for e in all_events(entry_id) if e.type == "link_recovered"]
    assert len(recovered) == 1
    assert recovered[0].device_id == device_id
    assert recovered[0].actor == "device"


@pytest.mark.parametrize("closed_status", ["seated", "no_show", "removed", "cancelled"])
def test_recover_link_on_closed_entry_409_without_event(env, closed_status):
    moved = move_to_status(env.client, env.lima_slug, env.token_lima_a, closed_status)

    resp = env.client.post(
        f"/api/tablet/entries/{moved['entry_id']}/recover-link", headers=auth_headers(env.token_lima_a)
    )
    assert resp.status_code == 409
    assert moved["public_token"] not in resp.text
    assert not any(e.type == "link_recovered" for e in all_events(moved["entry_id"]))


def test_on_my_way_flag_only_on_the_entry_that_sent_it(env):
    with_flag = move_to_status(env.client, env.lima_slug, env.token_lima_a, "called")
    without_flag = move_to_status(env.client, env.lima_slug, env.token_lima_a, "called")
    assert env.client.post(f"/api/entries/{with_flag['public_token']}/on-my-way").status_code == 200

    queue = env.client.get("/api/tablet/queue", headers=auth_headers(env.token_lima_a)).json()
    flags = {e["id"]: e["on_my_way"] for e in queue["entries"]}
    assert flags == {with_flag["entry_id"]: True, without_flag["entry_id"]: False}
