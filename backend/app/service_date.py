"""service_date: define el dia de servicio (nota tecnica: corte 05:00 local)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import clock


def service_date_for(utc_dt: datetime, tz_name: str, cutoff_hour: int) -> date:
    """Convierte a hora local, resta el corte y devuelve la fecha resultante."""
    aware_utc = utc_dt.replace(tzinfo=timezone.utc)
    local_dt = aware_utc.astimezone(ZoneInfo(tz_name))
    shifted = local_dt - timedelta(hours=cutoff_hour)
    return shifted.date()


def today_for_location(tz_name: str, cutoff_hour: int) -> date:
    return service_date_for(clock.now_utc(), tz_name, cutoff_hour)
