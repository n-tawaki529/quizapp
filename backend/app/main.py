import asyncio
import logging
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import text

from .config import get_settings
from .database import Base, engine
from .routers import admin_auth, events, media, participants, questions, quiz, ws
from .ws_manager import manager

logging.basicConfig(level=logging.INFO)

settings = get_settings()


class RequestReceivedAtMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        scope.setdefault("state", {})["quiz_received_at"] = datetime.now(timezone.utc)
        await self.app(scope, receive, send)


app = FastAPI(title="リアルタイム4択クイズ大会 API")
app.add_middleware(
    RequestReceivedAtMiddleware,
)

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


def _media_path(filename: str) -> Path | None:
    base_dir = Path(settings.media_local_dir).resolve()
    path = (base_dir / filename).resolve()
    if base_dir not in path.parents or not path.is_file():
        return None
    return path


def _parse_range(range_header: str | None, file_size: int) -> tuple[int, int] | None:
    if not range_header:
        return None
    if not range_header.startswith("bytes=") or "," in range_header:
        return (-1, -1)
    start_text, separator, end_text = range_header[6:].partition("-")
    if not separator:
        return (-1, -1)
    try:
        if not start_text:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                return (-1, -1)
            return (max(0, file_size - suffix_length), file_size - 1)
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
    except ValueError:
        return (-1, -1)
    if start < 0 or start >= file_size or end < start:
        return (-1, -1)
    return (start, min(end, file_size - 1))


@app.api_route("/media/{filename:path}", methods=["GET", "HEAD"], name="media")
def media_file(filename: str, request: Request):
    path = _media_path(filename)
    if path is None:
        return Response(status_code=404)

    file_size = path.stat().st_size
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    byte_range = _parse_range(request.headers.get("range"), file_size)
    common_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
    }

    if byte_range == (-1, -1):
        return Response(status_code=416, headers={**common_headers, "Content-Range": f"bytes */{file_size}"})
    if byte_range is None:
        return FileResponse(path, media_type=content_type, headers=common_headers)

    start, end = byte_range

    def iter_file():
        with path.open("rb") as file:
            file.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = file.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        **common_headers,
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Content-Length": str(end - start + 1),
    }
    return StreamingResponse(iter_file(), status_code=206, media_type=content_type, headers=headers)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _ensure_quiz_phase_enum_values()
    _ensure_question_practice_column()
    _ensure_question_media_columns()
    _ensure_choice_reveal_text_column()
    _ensure_ranking_reveal_column()
    _ensure_dynamic_correct_answer_columns()
    _ensure_answer_question_id_index()
    manager.set_loop(asyncio.get_event_loop())


def _ensure_quiz_phase_enum_values() -> None:
    """create_all() は既存のPostgres ENUM型に新しい値を追加してくれないため、
    アプリ起動時に不足している quiz_phase の値を安全に追加する(既存データは一切変更しない)。
    """
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        for value in (
            "QUESTION_TRANSITION",
            "PRE_QUESTION_MEDIA",
            "ANSWER_COUNT_SHOWN",
            "PRE_CORRECT_MEDIA",
            "CORRECT_ANSWER_SHOWN",
        ):
            conn.execute(text(f"ALTER TYPE quiz_phase ADD VALUE IF NOT EXISTS '{value}'"))
        conn.execute(text("ALTER TYPE question_media_type ADD VALUE IF NOT EXISTS 'AUDIO'"))


def _ensure_question_practice_column() -> None:
    """create_all() は既存のquestionsテーブルに新しいカラムを追加してくれないため、
    アプリ起動時に is_practice カラムが無ければ安全に追加する(既存データは一切変更しない)。
    """
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(
            text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT FALSE")
        )


def _ensure_ranking_reveal_column() -> None:
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS ranking_reveal_rank INTEGER"))


def _ensure_question_media_columns() -> None:
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS pre_question_media_type question_media_type NOT NULL DEFAULT 'NONE'"))
        conn.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS pre_question_media_url VARCHAR(1000)"))
        conn.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS pre_correct_media_type question_media_type NOT NULL DEFAULT 'NONE'"))
        conn.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS pre_correct_media_url VARCHAR(1000)"))


def _ensure_choice_reveal_text_column() -> None:
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text("ALTER TABLE choices ADD COLUMN IF NOT EXISTS reveal_text VARCHAR(20)"))


def _ensure_dynamic_correct_answer_columns() -> None:
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS dynamic_correct_answer BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE questions ALTER COLUMN correct_choice DROP NOT NULL"))


def _ensure_answer_question_id_index() -> None:
    """answers.question_idで絞り込むクエリ(bulk participant state生成/answered_count/correct_count集計)が
    (participant_id, question_id)の複合UNIQUE indexに頼らず効率的に絞り込めるよう、単独indexを追加する。
    """
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_answers_question_id ON answers (question_id)"))


@app.get("/api/health")
def health():
    return {"status": "ok"}
