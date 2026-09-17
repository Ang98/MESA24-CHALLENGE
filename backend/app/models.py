"""Modelo de datos (nota tecnica, seccion 3)."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    timezone: Mapped[str] = mapped_column(String, nullable=False)
    minutes_per_party: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_hours: Mapped[str | None] = mapped_column(String, nullable=True)

    devices: Mapped[list["Device"]] = relationship(back_populates="location")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    location: Mapped["Location"] = relationship(back_populates="devices")


class QueueEntry(Base):
    __tablename__ = "queue_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_token: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), nullable=False)
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    phone_e164: Mapped[str] = mapped_column(String, nullable=False)
    party_size: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    consent_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False)

    location: Mapped["Location"] = relationship()

    __table_args__ = (
        UniqueConstraint("location_id", "idempotency_key", name="uq_entry_idempotency"),
        Index(
            "uq_active_entry",
            "location_id",
            "service_date",
            "phone_e164",
            unique=True,
            sqlite_where=text("status IN ('waiting','called')"),
        ),
        Index(
            "ix_queue_lookup",
            "location_id",
            "service_date",
            "status",
            "joined_at",
        ),
    )


class EntryEvent(Base):
    __tablename__ = "entry_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("queue_entries.id"), nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    from_status: Mapped[str | None] = mapped_column(String, nullable=True)
    to_status: Mapped[str | None] = mapped_column(String, nullable=True)
    actor: Mapped[str] = mapped_column(String, nullable=False)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    __table_args__ = (
        # "Voy en camino" es un evento, no un estado (nota tecnica seccion 3):
        # un solo evento on_my_way por entrada, igual que uq_active_entry, lo
        # garantiza la base, no la aplicacion.
        Index(
            "uq_entry_on_my_way",
            "entry_id",
            unique=True,
            sqlite_where=text("type = 'on_my_way'"),
        ),
    )
