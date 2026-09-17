"""Interfaz de notificacion. En el corte solo existe la implementacion falsa."""
from __future__ import annotations

from typing import Protocol

from app.models import QueueEntry


class Notifier(Protocol):
    def notify_called(self, entry: QueueEntry) -> None:
        ...


class FakeNotifier:
    """Guarda las llamadas en una lista, para que los tests las inspeccionen."""

    def __init__(self) -> None:
        self.calls: list[QueueEntry] = []

    def notify_called(self, entry: QueueEntry) -> None:
        self.calls.append(entry)


class NoopNotifier:
    """Por defecto no envia ni guarda nada: en el corte la pantalla es el unico
    canal real. (FakeNotifier guardaria cada llamada mientras viva el proceso.)"""

    def notify_called(self, entry: QueueEntry) -> None:
        pass


_default_notifier = NoopNotifier()


def get_notifier() -> Notifier:
    """Dependencia FastAPI; los tests la sobreescriben con dependency_overrides."""
    return _default_notifier
