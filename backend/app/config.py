"""Configuracion leida desde variables de entorno.

Se lee en tiempo de uso (funcion get_settings, sin cache) para que los tests
puedan cambiar os.environ (p. ej. DATABASE_URL, TRUSTED_PROXY_HOPS) antes de
llamar a cada endpoint y que el cambio surta efecto sin reiniciar el proceso.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    service_day_cutoff_hour: int
    public_base_url: str
    cors_origins: list[str]
    trusted_proxy_hops: int
    rate_ip_max: int
    rate_ip_window_s: int
    rate_phone_max: int
    rate_phone_window_s: int


def get_settings() -> Settings:
    cors_origins_raw = os.environ.get("CORS_ORIGINS", "http://localhost:5173")
    return Settings(
        database_url=os.environ.get("DATABASE_URL", "sqlite:///./mesa.db"),
        service_day_cutoff_hour=int(os.environ.get("SERVICE_DAY_CUTOFF_HOUR", "5")),
        public_base_url=os.environ.get("PUBLIC_BASE_URL", "http://localhost:5173"),
        cors_origins=[o.strip() for o in cors_origins_raw.split(",") if o.strip()],
        trusted_proxy_hops=int(os.environ.get("TRUSTED_PROXY_HOPS", "0")),
        rate_ip_max=int(os.environ.get("RATE_IP_MAX", "20")),
        rate_ip_window_s=int(os.environ.get("RATE_IP_WINDOW_S", "600")),
        rate_phone_max=int(os.environ.get("RATE_PHONE_MAX", "3")),
        rate_phone_window_s=int(os.environ.get("RATE_PHONE_WINDOW_S", "3600")),
    )
