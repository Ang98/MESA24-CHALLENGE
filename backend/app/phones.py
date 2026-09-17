"""Normalizacion y utilidades de telefono (nota tecnica: Peru/Chile con SMS)."""
from __future__ import annotations

import re

_PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")
_STRIP_CHARS = re.compile(r"[\s\-.()]+")


class InvalidPhoneError(ValueError):
    pass


def normalize_phone(raw: str) -> str:
    """Quita espacios, guiones, puntos y parentesis; valida formato E.164."""
    cleaned = _STRIP_CHARS.sub("", raw or "")
    if not _PHONE_RE.match(cleaned):
        raise InvalidPhoneError("invalid phone format")
    return cleaned


def sms_supported(e164: str) -> bool:
    return e164.startswith("+51") or e164.startswith("+56")


def last3(e164: str) -> str:
    return e164[-3:]
