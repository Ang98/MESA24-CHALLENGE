"""Caso 12: el corte del dia de servicio a las 05:00 hora local."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import clock
from app.db import get_session_factory
from app.models import QueueEntry
from app.service_date import service_date_for
from tests.conftest import auth_headers, get_entry_id, make_entry

LIMA = "America/Lima"  # UTC-5 todo el ano, sin horario de verano


def _utc_naive_for_local(local_dt: datetime, tz_name: str) -> datetime:
    aware_local = local_dt.replace(tzinfo=ZoneInfo(tz_name))
    return aware_local.astimezone(timezone.utc).replace(tzinfo=None)


def test_service_date_before_cutoff_is_previous_day():
    local_before_cutoff = datetime(2024, 6, 18, 4, 59)
    utc_dt = _utc_naive_for_local(local_before_cutoff, LIMA)
    assert service_date_for(utc_dt, LIMA, cutoff_hour=5) == date(2024, 6, 17)


def test_service_date_at_cutoff_is_new_day():
    local_at_cutoff = datetime(2024, 6, 18, 5, 0)
    utc_dt = _utc_naive_for_local(local_at_cutoff, LIMA)
    assert service_date_for(utc_dt, LIMA, cutoff_hour=5) == date(2024, 6, 18)


# --- A traves de la API: el alta, la cola y el reporte usan el dia de servicio -
def test_join_late_night_belongs_to_the_service_day_that_started(env):
    # 03:00 UTC del 11 = 22:00 del 10 en Lima: en UTC ya es otro dia, pero el
    # servicio sigue siendo el del 10.
    env.clock.set(datetime(2024, 6, 11, 3, 0))
    token = make_entry(env.client, env.lima_slug)["public_token"]
    headers = auth_headers(env.token_lima_a)

    def joined_on(day):
        return env.client.get(f"/api/tablet/report?date={day}", headers=headers).json()["joined"]

    assert joined_on("2024-06-10") == 1
    assert joined_on("2024-06-11") == 0

    # 04:30 hora de Lima: todavia el mismo servicio, la entrada sigue en la cola.
    env.clock.set(datetime(2024, 6, 11, 9, 30))
    queue = env.client.get("/api/tablet/queue", headers=headers).json()
    assert [e["id"] for e in queue["entries"]] == [get_entry_id(token)]

    # 05:00 hora de Lima: empieza otro servicio y la cola arranca vacia, aunque
    # la entrada anterior siga en waiting.
    env.clock.set(datetime(2024, 6, 11, 10, 0))
    queue = env.client.get("/api/tablet/queue", headers=headers).json()
    assert queue["entries"] == []


def test_join_reads_the_clock_once_at_the_cutoff(env, monkeypatch):
    # Un reloj que avanza 1 ms en cada lectura, empezando 1 ms antes de las
    # 05:00 de Lima. Si el alta leyera la hora dos veces, joined_at quedaria en
    # un dia de servicio y service_date en el siguiente.
    ticks = {"now": datetime(2024, 6, 11, 9, 59, 59, 999000)}

    def ticking_now():
        current = ticks["now"]
        ticks["now"] = current + timedelta(milliseconds=1)
        return current

    monkeypatch.setattr(clock, "now_utc", ticking_now)
    token = make_entry(env.client, env.lima_slug)["public_token"]

    db = get_session_factory()()
    try:
        entry = db.query(QueueEntry).filter(QueueEntry.public_token == token).one()
        assert entry.service_date == service_date_for(entry.joined_at, LIMA, cutoff_hour=5)
        assert entry.consent_at == entry.joined_at
    finally:
        db.close()
