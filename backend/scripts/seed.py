"""Seed de datos de demo. Uso: python -m scripts.seed"""
from __future__ import annotations

import secrets

from app import clock
from app.auth import hash_token
from app.db import create_all, get_session_factory
from app.models import Device, Location

LOCATIONS = [
    {"slug": "demo-lima", "name": "Demo Lima", "timezone": "America/Lima", "minutes_per_party": 12},
    {"slug": "demo-santiago", "name": "Demo Santiago", "timezone": "America/Santiago", "minutes_per_party": 15},
]

DEVICES_BY_SLUG = {
    "demo-lima": ["Puerta 1", "Puerta 2"],
    "demo-santiago": ["Puerta 1"],
}


def _get_or_create_location(db, spec: dict) -> Location:
    location = db.query(Location).filter(Location.slug == spec["slug"]).first()
    if location is None:
        location = Location(
            slug=spec["slug"],
            name=spec["name"],
            timezone=spec["timezone"],
            minutes_per_party=spec["minutes_per_party"],
            opening_hours=None,
        )
        db.add(location)
        db.flush()
    return location


def main() -> None:
    create_all()
    db = get_session_factory()()
    try:
        locations = {spec["slug"]: _get_or_create_location(db, spec) for spec in LOCATIONS}

        # Revocar dispositivos anteriores: un token por tablet, sin reutilizar.
        now = clock.now_utc()
        for device in db.query(Device).filter(Device.revoked_at.is_(None)).all():
            device.revoked_at = now
        db.flush()

        print("Tokens de tablet generados (se guardan solo los hashes, anotar ahora):")
        for slug, device_names in DEVICES_BY_SLUG.items():
            location = locations[slug]
            for name in device_names:
                token = secrets.token_urlsafe(24)
                db.add(
                    Device(
                        location_id=location.id,
                        name=name,
                        token_hash=hash_token(token),
                        revoked_at=None,
                    )
                )
                print(f"  {slug} / {name}: {token}")

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
