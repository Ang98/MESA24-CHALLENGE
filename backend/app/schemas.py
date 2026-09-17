"""Modelos Pydantic de entrada/salida."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.phones import InvalidPhoneError, normalize_phone


class JoinEntryRequest(BaseModel):
    name: str
    phone: str
    party_size: int = Field(ge=1, le=20)
    consent: bool

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = v.strip()
        if not (1 <= len(v) <= 60):
            raise ValueError("name must be 1-60 characters after strip")
        return v

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, v: str) -> str:
        try:
            return normalize_phone(v)
        except InvalidPhoneError as exc:
            raise ValueError("invalid phone format") from exc

    @field_validator("consent")
    @classmethod
    def _validate_consent(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("consent must be true")
        return v


class LocationPublic(BaseModel):
    slug: str
    name: str


class EntryPublic(BaseModel):
    public_token: str
    status: str
    name: str
    phone: str
    party_size: int
    location: LocationPublic
    groups_ahead: int | None
    position: int | None
    wait_min: list[int] | None
    sms_supported: bool
    joined_at: str
    on_my_way: bool


class TabletQueueItem(BaseModel):
    id: int
    name: str
    party_size: int
    status: str
    joined_at: str
    phone_last3: str
    on_my_way: bool


class TabletQueueResponse(BaseModel):
    location: LocationPublic
    server_time: str
    entries: list[TabletQueueItem]


class RecoverLinkResponse(BaseModel):
    url: str


class ReportResponse(BaseModel):
    date: str
    is_today: bool
    joined: int
    seated: int
    left: int
    no_show: int
    unclosed: int
    in_progress: int
    removed: int
    avg_wait_min: float | None
