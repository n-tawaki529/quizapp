import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import Base, engine
from .routers import admin_auth, events, media, participants, questions, quiz, ws
from .ws_manager import manager

logging.basicConfig(level=logging.INFO)

settings = get_settings()

app = FastAPI(title="リアルタイム4択クイズ大会 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_auth.router)
app.include_router(events.router)
app.include_router(questions.router)
app.include_router(media.router)
app.include_router(participants.router)
app.include_router(quiz.router)
app.include_router(ws.router)

import os

os.makedirs(settings.media_local_dir, exist_ok=True)
app.mount(settings.media_base_url, StaticFiles(directory=settings.media_local_dir), name="media")


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    manager.set_loop(asyncio.get_event_loop())


@app.get("/api/health")
def health():
    return {"status": "ok"}
