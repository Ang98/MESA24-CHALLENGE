"""App FastAPI: routers, CORS y creacion de tablas al arrancar."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import get_settings
from app.routers import public, tablet


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.create_all()
    yield


app = FastAPI(title="Mesa247 - Lista de espera digital", lifespan=lifespan)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(tablet.router)
