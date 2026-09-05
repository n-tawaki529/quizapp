"""
現在のクイズ状態をロール(monitor / participant / admin)ごとに異なる形式で
組み立てるためのヘルパー。

重要な仕様:
- 参加者(スマートフォン)には問題・選択肢のメディアや選択肢テキストを一切送らない。
  問題文と A〜D のキーだけを送り、ボタンの有効/無効や解答済みかどうかを伝える。
- 会場モニターには問題文・メディア・選択肢の内容をすべて送る。
- 正解(correct_choice)はランキング表示以外のどの状態にも含めない。
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Answer, ChoiceKey, Event, Participant, Question


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def compute_ranking(db: Session, event_id: UUID, limit: int = 5) -> list[dict]:
    """正答数の多い順、次に正解問題の合計回答時間が短い順にランキングを算出する。"""
    rows = (
        db.query(
            Answer.participant_id,
            func.count(Answer.id).filter(Answer.is_correct.is_(True)).label("correct_count"),
            func.coalesce(
                func.sum(Answer.response_time_ms).filter(Answer.is_correct.is_(True)), 0
            ).label("total_time_ms"),
        )
        .filter(Answer.participant_id.in_(select(Participant.id).where(Participant.event_id == event_id)))
        .group_by(Answer.participant_id)
        .all()
    )

    participants = {p.id: p for p in db.query(Participant).filter(Participant.event_id == event_id).all()}

    # 未回答の参加者(正答0件)も含める場合は下位に来るため、集計に出てこなくても順位対象にする
    result = []
    seen_ids = set()
    for row in rows:
        seen_ids.add(row.participant_id)
        p = participants.get(row.participant_id)
        if p is None:
            continue
        result.append(
            {
                "participant_id": p.id,
                "name": p.name,
                "correct_count": int(row.correct_count or 0),
                "total_response_time_ms": int(row.total_time_ms or 0),
            }
        )
    for pid, p in participants.items():
        if pid not in seen_ids:
            result.append(
                {"participant_id": p.id, "name": p.name, "correct_count": 0, "total_response_time_ms": 0}
            )

    # 正答数降順、合計時間昇順、participant_id昇順(安定した順序のため)
    result.sort(key=lambda r: (-r["correct_count"], r["total_response_time_ms"], str(r["participant_id"])))

    ranked = []
    for i, r in enumerate(result[:limit]):
        ranked.append({**r, "rank": i + 1})
    return ranked


def build_choice_out(choice) -> dict:
    return {
        "choice_key": choice.choice_key.value,
        "content_type": choice.content_type.value,
        "text": choice.text,
        "media_url": choice.media_url,
    }


def build_monitor_state(db: Session, event: Event) -> dict:
    question = None
    if event.current_question_id:
        question = db.get(Question, event.current_question_id)

    now = datetime.now(timezone.utc)
    remaining_ms = None
    if event.phase.value == "ANSWER_OPEN" and event.answer_deadline:
        remaining_ms = max(0, int((event.answer_deadline - now).total_seconds() * 1000))

    state = {
        "type": "state_sync",
        "role": "monitor",
        "event_id": str(event.id),
        "event_name": event.name,
        "event_status": event.status.value,
        "phase": event.phase.value,
        "answer_started_at": _iso(event.answer_started_at),
        "answer_deadline": _iso(event.answer_deadline),
        "remaining_ms": remaining_ms,
        "server_time": _iso(now),
        "question": None,
        "ranking": None,
    }
    if question:
        state["question"] = {
            "id": str(question.id),
            "question_number": question.question_number,
            "question_text": question.question_text,
            "question_media_type": question.question_media_type.value,
            "question_media_url": question.question_media_url,
            "time_limit_seconds": question.time_limit_seconds,
            "choices": [build_choice_out(c) for c in question.choices],
        }
    if event.phase.value == "RANKING":
        state["ranking"] = compute_ranking(db, event.id)
    return state


def build_participant_state(db: Session, event: Event, participant_id: UUID | None = None) -> dict:
    question = None
    if event.current_question_id:
        question = db.get(Question, event.current_question_id)

    now = datetime.now(timezone.utc)
    remaining_ms = None
    if event.phase.value == "ANSWER_OPEN" and event.answer_deadline:
        remaining_ms = max(0, int((event.answer_deadline - now).total_seconds() * 1000))

    already_answered = False
    if question is not None and participant_id is not None:
        already_answered = (
            db.query(Answer)
            .filter(Answer.participant_id == participant_id, Answer.question_id == question.id)
            .first()
            is not None
        )

    state = {
        "type": "state_sync",
        "role": "participant",
        "event_id": str(event.id),
        "phase": event.phase.value,
        "answer_deadline": _iso(event.answer_deadline),
        "remaining_ms": remaining_ms,
        "server_time": _iso(now),
        "question": None,
        "already_answered": already_answered,
    }
    if question:
        state["question"] = {
            "id": str(question.id),
            "question_number": question.question_number,
            "question_text": question.question_text,
            "choice_keys": [c.value for c in ChoiceKey],
        }
    return state


def build_admin_state(db: Session, event: Event) -> dict:
    from .ws_manager import manager

    state = build_monitor_state(db, event)
    state["role"] = "admin"
    state["participant_count"] = db.query(Participant).filter(Participant.event_id == event.id).count()
    answered_count = 0
    if event.current_question_id:
        answered_count = db.query(Answer).filter(Answer.question_id == event.current_question_id).count()
    state["answered_count"] = answered_count
    state["connected_participant_count"] = manager.count(str(event.id), "participant")
    return state
