import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

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
    _ensure_quiz_phase_enum_values()
    _ensure_question_practice_column()
    manager.set_loop(asyncio.get_event_loop())


def _ensure_quiz_phase_enum_values() -> None:
    """create_all() は既存のPostgres ENUM型に新しい値を追加してくれないため、
    アプリ起動時に不足している quiz_phase の値を安全に追加する(既存データは一切変更しない)。
    """
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        for value in ("ANSWER_COUNT_SHOWN", "CORRECT_ANSWER_SHOWN"):
            conn.execute(text(f"ALTER TYPE quiz_phase ADD VALUE IF NOT EXISTS '{value}'"))


def _ensure_question_practice_column() -> None:
    """create_all() は既存のquestionsテーブルに新しいカラムを追加してくれないため、
    アプリ起動時に is_practice カラムが無ければ安全に追加する(既存データは一切変更しない)。
    """
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(
            text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT FALSE")
        )


@app.get("/api/health")
def health():
    return {"status": "ok"}
