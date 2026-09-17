"""Caso 13: reporte diario, hoy vs dia pasado, con el invariante y el promedio
de espera. Incluye una entrada `removed` para distinguirla del resto."""
from __future__ import annotations

from tests.conftest import auth_headers, get_entry_id, make_entry


def test_report_today_vs_past_day_invariant_and_avg_wait(env):
    slug = env.lima_slug
    device = env.token_lima_a
    headers = auth_headers(device)

    # E1: se une y se sienta 5 minutos despues.
    e1 = make_entry(env.client, slug)
    id1 = get_entry_id(e1["public_token"])
    env.clock.advance(minutes=5)
    assert env.client.post(f"/api/tablet/entries/{id1}/seat", headers=headers).status_code == 200

    # E2: se une despues y se sienta 7 minutos mas tarde.
    e2 = make_entry(env.client, slug)
    id2 = get_entry_id(e2["public_token"])
    env.clock.advance(minutes=7)
    assert env.client.post(f"/api/tablet/entries/{id2}/seat", headers=headers).status_code == 200

    # E3: se va sin sentarse (cancela).
    e3 = make_entry(env.client, slug)
    assert env.client.post(f"/api/entries/{e3['public_token']}/cancel").status_code == 200

    # E4: se queda esperando y nadie la cierra.
    make_entry(env.client, slug)

    # E5: la llaman y nadie la cierra (sin cerrar / en curso, segun el dia).
    e5 = make_entry(env.client, slug)
    id5 = get_entry_id(e5["public_token"])
    assert env.client.post(f"/api/tablet/entries/{id5}/call", headers=headers).status_code == 200

    # E6: no vino.
    e6 = make_entry(env.client, slug)
    id6 = get_entry_id(e6["public_token"])
    assert env.client.post(f"/api/tablet/entries/{id6}/call", headers=headers).status_code == 200
    assert env.client.post(f"/api/tablet/entries/{id6}/no-show", headers=headers).status_code == 200

    # E7: quitada por el anfitrion (fuera de todas las categorias).
    e7 = make_entry(env.client, slug)
    id7 = get_entry_id(e7["public_token"])
    assert env.client.post(f"/api/tablet/entries/{id7}/remove", headers=headers).status_code == 200

    joined_total = 7

    def check_invariant(report):
        assert (
            report["seated"] + report["left"] + report["no_show"] + report["unclosed"] + report["in_progress"]
            == report["joined"] - report["removed"]
        )

    # Reporte de "hoy", sin mover el reloj de dia de servicio.
    report_today = env.client.get("/api/tablet/report", headers=headers).json()
    assert report_today["is_today"] is True
    assert report_today["joined"] == joined_total
    assert report_today["seated"] == 2
    assert report_today["no_show"] == 1
    assert report_today["removed"] == 1
    assert report_today["left"] == 1  # solo E3 (cancelado); E4 no cuenta hoy
    assert report_today["unclosed"] == 0
    assert report_today["in_progress"] == 2  # E4 (waiting) + E5 (called)
    assert report_today["avg_wait_min"] == 6.0  # (5 + 7) / 2
    check_invariant(report_today)

    report_date = report_today["date"]

    # Avanzamos al dia de servicio siguiente y pedimos el reporte del dia pasado.
    env.clock.advance(hours=24)
    report_past = env.client.get(
        "/api/tablet/report", params={"date": report_date}, headers=headers
    ).json()
    assert report_past["is_today"] is False
    assert report_past["date"] == report_date
    assert report_past["joined"] == joined_total
    assert report_past["seated"] == 2
    assert report_past["no_show"] == 1
    assert report_past["removed"] == 1
    assert report_past["left"] == 2  # E3 (cancelado) + E4 (seguia esperando)
    assert report_past["unclosed"] == 1  # E5 (llamado, nunca cerrado)
    assert report_past["in_progress"] == 0
    assert report_past["avg_wait_min"] == 6.0  # no cambia: ya estaba fijado
    check_invariant(report_past)
