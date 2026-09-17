"""Rate limit en memoria (ventana deslizante) e IP del cliente."""
from __future__ import annotations

import math
import threading
import time
from collections import deque

from fastapi import Request

_lock = threading.Lock()
_hits: dict[tuple, deque] = {}


def client_ip(request: Request, trusted_proxy_hops: int) -> str:
    """IP real del cliente, nunca el primer valor de X-Forwarded-For."""
    if trusted_proxy_hops <= 0:
        return request.client.host if request.client else ""

    xff = request.headers.get("x-forwarded-for")
    if not xff:
        return request.client.host if request.client else ""

    parts = [p.strip() for p in xff.split(",") if p.strip()]
    if len(parts) < trusted_proxy_hops:
        return request.client.host if request.client else ""

    return parts[-trusted_proxy_hops]


def hit(key: tuple, max_hits: int, window_s: int) -> int | None:
    """Registra un intento. Devuelve None si esta dentro del limite, o los
    segundos de espera (Retry-After) si lo excede."""
    now = time.monotonic()
    with _lock:
        dq = _hits.setdefault(key, deque())
        while dq and now - dq[0] >= window_s:
            dq.popleft()

        if len(dq) >= max_hits:
            retry_after = window_s - (now - dq[0])
            return max(1, math.ceil(retry_after))

        dq.append(now)
        return None


def reset() -> None:
    """Limpia todo el estado. Se usa entre tests."""
    with _lock:
        _hits.clear()
