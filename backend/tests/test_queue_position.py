"""Caso 10: el puesto (groups_ahead) nunca sube y solo cuenta a quienes estan
en waiting delante, en el mismo local y el mismo dia de servicio."""
from __future__ import annotations

import random
from datetime import timedelta

from tests.conftest import auth_headers, get_entry_id, make_entry


def _groups_ahead(client, token):
    resp = client.get(f"/api/entries/{token}")
    assert resp.status_code == 200
    return resp.json()


def test_groups_ahead_never_increases_and_position_wait_min_match_formula(env):
    slug = env.lima_slug
    headers = auth_headers(env.token_lima_a)
    m = env.lima_minutes_per_party

    # Ruido que no debe contar: una entrada en waiting del dia anterior y
    # entradas en waiting de otro local, con joined_at anterior al target.
    env.clock.advance(days=-1)
    make_entry(env.client, slug)
    env.clock.advance(days=1)
    for _ in range(2):
        make_entry(env.client, env.santiago_slug)
        env.clock.advance(minutes=1)

    ahead_tokens = []
    for _ in range(5):
        ahead_tokens.append(make_entry(env.client, slug)["public_token"])
        env.clock.advance(minutes=1)
    target_token = make_entry(env.client, slug)["public_token"]
    env.clock.advance(minutes=1)
    for _ in range(2):  # detras del target: no deben afectarlo
        make_entry(env.client, slug)
        env.clock.advance(minutes=1)

    history = [_groups_ahead(env.client, target_token)]
    assert history[0]["groups_ahead"] == 5
    assert history[0]["position"] == 6  # 5 delante + 1
    assert history[0]["wait_min"] == [5 * m, 6 * m]

    # Cada accion aparece al menos una vez; el orden y las filas son aleatorios
    # con semilla fija. Entre accion y accion se une alguien nuevo (detras).
    rng = random.Random(42)
    actions = ["call", "seat", "remove", "cancel", rng.choice(["call", "seat", "remove", "cancel"])]
    rng.shuffle(actions)
    rows = list(ahead_tokens)
    rng.shuffle(rows)

    for action, token in zip(actions, rows):
        entry_id = get_entry_id(token)
        if action == "cancel":
            resp = env.client.post(f"/api/entries/{token}/cancel")
        else:
            resp = env.client.post(f"/api/tablet/entries/{entry_id}/{action}", headers=headers)
        assert resp.status_code == 200, resp.text

        make_entry(env.client, slug)
        env.clock.advance(minutes=1)
        history.append(_groups_ahead(env.client, target_token))

    ahead_values = [h["groups_ahead"] for h in history]
    assert ahead_values == [5, 4, 3, 2, 1, 0]

    for h in history:
        ahead = h["groups_ahead"]
        assert h["position"] == ahead + 1
        assert h["wait_min"] == [ahead * m, (ahead + 1) * m]


def test_order_is_by_joined_at_not_by_id(env):
    # La entrada creada despues (id mayor) tiene joined_at anterior: va delante.
    later = make_entry(env.client, env.lima_slug)
    env.clock.set(env.clock.now - timedelta(minutes=10))
    earlier = make_entry(env.client, env.lima_slug)

    assert _groups_ahead(env.client, earlier["public_token"])["groups_ahead"] == 0
    assert _groups_ahead(env.client, later["public_token"])["groups_ahead"] == 1

    queue = env.client.get("/api/tablet/queue", headers=auth_headers(env.token_lima_a)).json()
    assert [e["id"] for e in queue["entries"]] == [
        get_entry_id(earlier["public_token"]),
        get_entry_id(later["public_token"]),
    ]


def test_same_joined_at_ties_broken_by_id(env):
    first = make_entry(env.client, env.lima_slug)
    second = make_entry(env.client, env.lima_slug)  # mismo instante (reloj congelado)

    assert _groups_ahead(env.client, first["public_token"])["groups_ahead"] == 0
    assert _groups_ahead(env.client, second["public_token"])["groups_ahead"] == 1
