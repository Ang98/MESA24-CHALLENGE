"""Engine, sesiones y Base declarativa.

La configuracion (DATABASE_URL) se relee en cada llamada a get_engine(), asi
los tests pueden cambiar la variable de entorno antes de crear las tablas o
antes de pedir una sesion, sin necesidad de recargar el modulo.
"""
from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import get_settings

Base = declarative_base()

_engine = None
_engine_url: str | None = None
_session_factory = None


def _build_engine(url: str):
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, future=True)

    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, connection_record):  # pragma: no cover
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def get_engine():
    """Crea (o reutiliza) el engine segun la DATABASE_URL vigente."""
    global _engine, _engine_url, _session_factory
    settings = get_settings()
    if _engine is None or _engine_url != settings.database_url:
        _engine = _build_engine(settings.database_url)
        _engine_url = settings.database_url
        _session_factory = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
    return _engine


def get_session_factory():
    get_engine()
    assert _session_factory is not None
    return _session_factory


def create_all() -> None:
    Base.metadata.create_all(bind=get_engine())


def get_db():
    """Dependencia FastAPI: entrega una sesion y la cierra al terminar."""
    session_factory = get_session_factory()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()
