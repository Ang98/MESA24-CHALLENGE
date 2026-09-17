"""Casos 1, 2, 3, 7 y 14 de la especificacion, mas las carreras entre la
lectura y el UPDATE (transiciones, "Voy en camino" y "Recuperar turno")."""
from __future__ import annotations

import pytest
from sqlalchemy import update as sa_update

import app.transitions as transitions_module
from app.db import get_session_factory
from app.main import app
from app.models import QueueEntry
from app.notifier import get_notifier
from tests.conftest import (
    all_events,
    auth_headers,
    device_id_for_token,
    get_entry_id,
    get_status,
    last_event,
    make_entry,
    move_to_status,
)

ALL_STATUSES = ["waiting", "called", "seated", "no_show", "removed", "cancelled"]

# Caso 1: tabla completa de transiciones (nota tecnica / spec).
ACTIONS = {
    "call": {"valid_from": {"waiting"}, "to": "called", "endpoint": "call", "kind": "device"},
    "seat": {"valid_from": {"waiting", "called"}, "to": "seated", "endpoint": "seat", "kind": "device"},
    "no_show": {"valid_from": {"called"}, "to": "no_show", "endpoint": "no-show", "kind": "device"},
    "remove": {"valid_from": {"waiting"}, "to": "removed", "endpoint": "remove", "kind": "device"},
    "cancel": {"valid_from": {"waiting", "called"}, "to": "cancelled", "endpoint": "cancel", "kind": "customer"},
}


# --- Caso 1 ----------------------------------------------------------------
@pytest.mark.parametrize("start_status", ALL_STATUSES)
@pytest.mark.parametrize("action_name", list(ACTIONS.keys()))
def test_transition_table(env, action_name, start_status):
    action = ACTIONS[action_name]
    moved = move_to_status(env.client, env.lima_slug, env.token_lima_a, start_status)
    entry_id, token = moved["entry_id"], moved["public_token"]
    events_before = len(all_events(entry_id))

    if action["kind"] == "device":
        resp = env.client.post(
            f"/api/tablet/entries/{entry_id}/{action['endpoint']}",
            headers=auth_headers(env.token_lima_a),
        )
    else:
        resp = env.client.post(f"/api/entries/{token}/{action['endpoint']}")

    if start_status in action["valid_from"]:
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == action["to"]

        ev = last_event(entry_id)
        assert ev.type == action["to"]
        assert ev.from_status == start_status
        assert ev.to_status == action["to"]
        assert ev.actor == action["kind"]
        if action["kind"] == "device":
            assert ev.device_id == device_id_for_token(env.token_lima_a)
        else:
            assert ev.device_id is None
        assert len(all_events(entry_id)) == events_before + 1
    else:
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["code"] == "invalid_transition"
        assert detail["current_status"] == start_status
        # una transicion invalida no debe registrar un evento nuevo
        assert len(all_events(entry_id)) == events_before
        assert get_status(entry_id) == start_status


# --- Caso 2 ------------------------------------------------------------
@pytest.mark.parametrize("first,second", [("a", "b"), ("b", "a")])
def test_two_tablets_call_race(env, first, second):
    tokens = {"a": env.token_lima_a, "b": env.token_lima_b}
    entry = make_entry(env.client, env.lima_slug)
    entry_id = get_entry_id(entry["public_token"])

    r1 = env.client.post(f"/api/tablet/entries/{entry_id}/call", headers=auth_headers(tokens[first]))
    assert r1.status_code == 200

    r2 = env.client.post(f"/api/tablet/entries/{entry_id}/call", headers=auth_headers(tokens[second]))
    assert r2.status_code == 409
    assert r2.json()["detail"]["current_status"] == "called"


@pytest.mark.parametrize("first,second", [("a", "b"), ("b", "a")])
def test_two_tablets_seat_then_no_show_race(env, first, second):
    tokens = {"a": env.token_lima_a, "b": env.token_lima_b}
    entry = make_entry(env.client, env.lima_slug)
    entry_id = get_entry_id(entry["public_token"])

    r1 = env.client.post(f"/api/tablet/entries/{entry_id}/seat", headers=auth_headers(tokens[first]))
    assert r1.status_code == 200

    r2 = env.client.post(f"/api/tablet/entries/{entry_id}/no-show", headers=auth_headers(tokens[second]))
    assert r2.status_code == 409
    assert r2.json()["detail"]["current_status"] == "seated"


# --- Caso 3 ------------------------------------------------------------
@pytest.mark.parametrize("first_action", ["cancel", "seat"])
def test_cancel_vs_seat_race(env, first_action):
    entry = make_entry(env.client, env.lima_slug)
    entry_id = get_entry_id(entry["public_token"])
    token = entry["public_token"]

    def do_cancel():
        return env.client.post(f"/api/entries/{token}/cancel")

    def do_seat():
        return env.client.post(f"/api/tablet/entries/{entry_id}/seat", headers=auth_headers(env.token_lima_a))

    if first_action == "cancel":
        r1, r2, expected_final = do_cancel(), do_seat(), "cancelled"
    else:
        r1, r2, expected_final = do_seat(), do_cancel(), "seated"

    assert r1.status_code == 200
    assert r2.status_code == 409
    assert r2.json()["detail"]["current_status"] == expected_final
    assert get_status(entry_id) == expected_final

    # Un solo evento de cambio de estado (ademas de "joined").
    change_events = [e for e in all_events(entry_id) if e.type in ("seated", "cancelled")]
    assert len(change_events) == 1
    assert change_events[0].to_status == expected_final


# --- Caso 7 --------------------------------------------------------------
@pytest.mark.parametrize("start_status", ["waiting", "seated", "cancelled"])
def test_on_my_way_invalid_outside_called(env, start_status):
    moved = move_to_status(env.client, env.lima_slug, env.token_lima_a, start_status)
    resp = env.client.post(f"/api/entries/{moved['public_token']}/on-my-way")
    assert resp.status_code == 409
    assert resp.json()["detail"]["current_status"] == start_status


def test_on_my_way_valid_in_called_and_visible_on_tablet(env):
    moved = move_to_status(env.client, env.lima_slug, env.token_lima_a, "called")
    resp = env.client.post(f"/api/entries/{moved['public_token']}/on-my-way")
    assert resp.status_code == 200
    assert resp.json()["status"] == "called"

    queue = env.client.get("/api/tablet/queue", headers=auth_headers(env.token_lima_a)).json()
    item = next(e for e in queue["entries"] if e["id"] == moved["entry_id"])
    assert item["on_my_way"] is True


# --- Caso 14 ---------------------------------------------------------------
def test_notifier_called_once_on_call_never_on_join(env):
    entry = make_entry(env.client, env.lima_slug)
    assert env.notifier.calls == []  # nunca se notifica al unirse

    entry_id = get_entry_id(entry["public_token"])
    resp = env.client.post(f"/api/tablet/entries/{entry_id}/call", headers=auth_headers(env.token_lima_a))
    assert resp.status_code == 200

    assert len(env.notifier.calls) == 1
    assert env.notifier.calls[0].id == entry_id


def test_notifier_runs_after_commit(env):
    # Si se notificara antes del commit, otra conexion todavia veria "waiting".
    seen = []

    class SpyNotifier:
        def notify_called(self, entry):
            other_db = get_session_factory()()
            try:
                seen.append(other_db.get(QueueEntry, entry.id).status)
            finally:
                other_db.close()

    app.dependency_overrides[get_notifier] = lambda: SpyNotifier()
    entry_id = get_entry_id(make_entry(env.client, env.lima_slug)["public_token"])
    resp = env.client.post(f"/api/tablet/entries/{entry_id}/call", headers=auth_headers(env.token_lima_a))
    assert resp.status_code == 200
    assert seen == ["called"]


@pytest.mark.parametrize("phone,notified", [("+56912345678", True), ("+12025550123", False)])
def test_notifier_only_for_peru_and_chile(env, phone, notified):
    entry_id = get_entry_id(make_entry(env.client, env.lima_slug, phone=phone)["public_token"])
    resp = env.client.post(f"/api/tablet/entries/{entry_id}/call", headers=auth_headers(env.token_lima_a))
    assert resp.status_code == 200
    assert (len(env.notifier.calls) == 1) is notified


# --- Extra: carreras entre la lectura y el UPDATE -------------------------
def _change_status_after_first_read(monkeypatch, new_status):
    """Simula otra tablet: justo despues de que la funcion lee la entrada, otra
    conexion cambia su estado y hace commit."""
    original_get = transitions_module._get_entry_in_location
    state = {"calls": 0}

    def fake_get_entry_in_location(db, e_id, location_id):
        state["calls"] += 1
        result = original_get(db, e_id, location_id)
        if state["calls"] == 1:
            other_db = get_session_factory()()
            other_db.execute(sa_update(QueueEntry).where(QueueEntry.id == e_id).values(status=new_status))
            other_db.commit()
            other_db.close()
        return result

    monkeypatch.setattr(transitions_module, "_get_entry_in_location", fake_get_entry_in_location)


def _run(fn, **kwargs):
    db = get_session_factory()()
    try:
        with pytest.raises(transitions_module.TransitionError) as exc_info:
            fn(db, **kwargs)
        return exc_info.value
    finally:
        db.close()


def test_transition_race_between_read_and_update_returns_409_without_fake_event(env, monkeypatch):
    """Se usa "seat" porque acepta waiting y called: con solo el IN, el UPDATE
    pasaria igual y el evento quedaria con from_status="waiting" falso."""
    entry_id = get_entry_id(make_entry(env.client, env.lima_slug)["public_token"])
    _change_status_after_first_read(monkeypatch, "called")

    err = _run(
        transitions_module.apply_transition,
        entry_id=entry_id,
        location_id=env.lima_id,
        action="seat",
        device_id=device_id_for_token(env.token_lima_a),
    )
    assert err.status_code == 409
    assert err.current_status == "called"
    assert not any(e.type == "seated" for e in all_events(entry_id))
    assert get_status(entry_id) == "called"


def test_on_my_way_race_with_seat_returns_409_without_event(env, monkeypatch):
    # El comensal toca "Voy en camino" mientras la tablet lo sienta.
    moved = move_to_status(env.client, env.lima_slug, env.token_lima_a, "called")
    _change_status_after_first_read(monkeypatch, "seated")

    err = _run(transitions_module.apply_on_my_way, entry_id=moved["entry_id"], location_id=env.lima_id)
    assert err.status_code == 409
    assert err.current_status == "seated"
    assert not any(e.type == "on_my_way" for e in all_events(moved["entry_id"]))


def test_link_recovered_race_with_seat_returns_409_without_event(env, monkeypatch):
    # El anfitrion pide el enlace mientras la otra tablet sienta a esa persona.
    entry_id = get_entry_id(make_entry(env.client, env.lima_slug)["public_token"])
    _change_status_after_first_read(monkeypatch, "seated")

    err = _run(
        transitions_module.apply_link_recovered,
        entry_id=entry_id,
        location_id=env.lima_id,
        device_id=device_id_for_token(env.token_lima_a),
    )
    assert err.status_code == 409
    assert err.current_status == "seated"
    assert not any(e.type == "link_recovered" for e in all_events(entry_id))
