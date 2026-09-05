from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models import Answer, Event, EventStatus, Participant, Question, QuizPhase
from ..quiz_state import build_admin_state, build_monitor_state, build_participant_state, compute_ranking
from ..schemas import AnswerRequest, AnswerResult, RankingResponse
from ..security import require_admin, require_participant
from ..ws_manager import manager

router = APIRouter(tags=["quiz"])


def _get_event_or_404(db: Session, event_id: UUID) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="大会が見つかりません")
    return event


def _broadcast_current_state(db: Session, event: Event) -> None:
    monitor_state = build_monitor_state(db, event)
    admin_state = build_admin_state(db, event)
    manager.broadcast_all_sync(str(event.id), {"monitor": monitor_state, "admin": admin_state})

    # participantロールへは、接続中の参加者ごとに自分自身の正解数(correct_count)を
    # 個別に計算してパーソナライズした状態を配信する(他人の正解数は一切送らない)。
    default_participant_state = build_participant_state(db, event)
    connected_ids = manager.connected_participant_ids(str(event.id))
    per_participant_state = {
        pid: build_participant_state(db, event, UUID(pid)) for pid in connected_ids
    }
    manager.broadcast_participant_personalized_sync(str(event.id), default_participant_state, per_participant_state)


def _close_answer_if_still_open_sync(event_id: UUID, question_id: UUID) -> None:
    db = SessionLocal()
    try:
        event = db.get(Event, event_id)
        if event is None:
            return
        # 管理者が既に次の操作を行っていた場合は何もしない(同じ問題がANSWER_OPENのままの時だけ閉じる)
        if event.phase == QuizPhase.ANSWER_OPEN and event.current_question_id == question_id:
            event.phase = QuizPhase.ANSWER_CLOSED
            db.commit()
            db.refresh(event)
            _broadcast_current_state(db, event)
    finally:
        db.close()


async def _auto_close_after_deadline(event_id: UUID, question_id: UUID, deadline: datetime) -> None:
    import asyncio

    delay = (deadline - datetime.now(timezone.utc)).total_seconds()
    if delay > 0:
        await asyncio.sleep(delay)
    await asyncio.to_thread(_close_answer_if_still_open_sync, event_id, question_id)


# ---------------- 管理者: クイズ進行操作 ----------------
def _advance_to_next_question(db: Session, event: Event) -> Question:
    """次の問題を表示状態にする(回答受付はまだ開始しない)。次の問題がなければ422を送出する。"""
    current_number = 0
    if event.current_question_id:
        current_q = db.get(Question, event.current_question_id)
        current_number = current_q.question_number if current_q else 0
    elif (
        db.query(Question).filter(Question.event_id == event.id, Question.is_practice.is_(True)).first()
        is not None
    ):
        # 大会開始直後、練習問題(問題番号0番に予約)が存在する場合はそちらを先に出題する。
        current_number = -1

    next_q = (
        db.query(Question)
        .filter(Question.event_id == event.id, Question.question_number == current_number + 1)
        .first()
    )
    if next_q is None:
        raise HTTPException(status_code=422, detail="次の問題はありません")

    event.current_question_id = next_q.id
    event.phase = QuizPhase.QUESTION_SHOWN
    event.answer_started_at = None
    event.answer_deadline = None
    if event.status == EventStatus.CREATED:
        event.status = EventStatus.RUNNING
    return next_q


def _open_answer_window(event: Event, question: Question) -> None:
    """回答受付を開始し、制限時間の締切と計測開始時刻を記録する。"""
    now = datetime.now(timezone.utc)
    event.answer_started_at = now
    event.answer_deadline = now + timedelta(seconds=question.time_limit_seconds)
    event.phase = QuizPhase.ANSWER_OPEN


@router.post("/api/admin/events/{event_id}/next")
def next_question(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    event = _get_event_or_404(db, event_id)
    _advance_to_next_question(db, event)
    db.commit()
    db.refresh(event)

    _broadcast_current_state(db, event)
    return {"ok": True}


@router.post("/api/admin/events/{event_id}/start-answer")
def start_answer(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    event = _get_event_or_404(db, event_id)
    if event.current_question_id is None:
        raise HTTPException(status_code=422, detail="表示中の問題がありません")
    if event.phase not in (QuizPhase.QUESTION_SHOWN,):
        raise HTTPException(status_code=422, detail="回答受付を開始できる状態ではありません")

    question = db.get(Question, event.current_question_id)
    _open_answer_window(event, question)
    db.commit()
    db.refresh(event)

    _broadcast_current_state(db, event)
    manager.schedule_sync(_auto_close_after_deadline(event.id, question.id, event.answer_deadline))
    return {"ok": True}


@router.post("/api/admin/events/{event_id}/next-and-start-answer")
def next_and_start_answer(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """「次の問題へ」と「回答開始」をまとめて1回の操作で行う。"""
    event = _get_event_or_404(db, event_id)
    next_q = _advance_to_next_question(db, event)
    _open_answer_window(event, next_q)
    db.commit()
    db.refresh(event)

    _broadcast_current_state(db, event)
    manager.schedule_sync(_auto_close_after_deadline(event.id, next_q.id, event.answer_deadline))
    return {"ok": True}


@router.post("/api/admin/events/{event_id}/show-answer-count")
def show_answer_count(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """回答受付終了後、各選択肢の回答人数を会場モニターに表示する(正解はまだ発表しない)。"""
    event = _get_event_or_404(db, event_id)
    if event.phase != QuizPhase.ANSWER_CLOSED:
        raise HTTPException(status_code=422, detail="回答受付終了後に実行してください")
    event.phase = QuizPhase.ANSWER_COUNT_SHOWN
    db.commit()
    db.refresh(event)

    _broadcast_current_state(db, event)
    return {"ok": True}


@router.post("/api/admin/events/{event_id}/show-correct-answer")
def show_correct_answer(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """回答人数表示後、正解を会場モニターに発表する。"""
    event = _get_event_or_404(db, event_id)
    if event.phase != QuizPhase.ANSWER_COUNT_SHOWN:
        raise HTTPException(status_code=422, detail="回答結果を表示してから実行してください")
    event.phase = QuizPhase.CORRECT_ANSWER_SHOWN
    db.commit()
    db.refresh(event)

    _broadcast_current_state(db, event)
    return {"ok": True}


@router.post("/api/admin/events/{event_id}/show-ranking")
def show_ranking(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    event = _get_event_or_404(db, event_id)
    event.phase = QuizPhase.RANKING
    db.commit()
    db.refresh(event)
    _broadcast_current_state(db, event)
    return {"ok": True}


@router.get("/api/admin/events/{event_id}/ranking", response_model=RankingResponse)
def admin_ranking(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    _get_event_or_404(db, event_id)
    return RankingResponse(entries=compute_ranking(db, event_id))


@router.get("/api/admin/events/{event_id}/state")
def admin_state(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    event = _get_event_or_404(db, event_id)
    return build_admin_state(db, event)


# ---------------- 公開: 状態同期(再接続時の復元用) ----------------
@router.get("/api/events/{event_id}/state")
def public_state(
    event_id: UUID,
    role: str = "participant",
    participant_id: UUID | None = None,
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, event_id)
    if role == "monitor":
        return build_monitor_state(db, event)
    return build_participant_state(db, event, participant_id)


@router.get("/api/time")
def server_time():
    return {"server_time": datetime.now(timezone.utc).isoformat()}


# ---------------- 参加者: 回答送信 ----------------
@router.post("/api/events/{event_id}/answer", response_model=AnswerResult)
def submit_answer(
    event_id: UUID,
    body: AnswerRequest,
    db: Session = Depends(get_db),
    payload: dict = Depends(require_participant),
):
    # 他人のparticipant_idを指定して回答できないようにする
    if payload.get("event_id") != str(event_id) or payload.get("participant_id") != str(body.participant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="他の参加者として回答することはできません")

    event = _get_event_or_404(db, event_id)
    participant = db.get(Participant, body.participant_id)
    if participant is None or participant.event_id != event_id:
        raise HTTPException(status_code=404, detail="参加者が見つかりません")

    if event.phase != QuizPhase.ANSWER_OPEN or event.current_question_id != body.question_id:
        return AnswerResult(accepted=False, message="現在この問題の回答は受け付けていません")

    now = datetime.now(timezone.utc)
    # サーバー側でも必ず制限時間内かどうかを判定する
    if event.answer_deadline is None or now > event.answer_deadline:
        return AnswerResult(accepted=False, message="回答受付時間が終了しています")

    question = db.get(Question, body.question_id)
    if question is None or question.event_id != event_id:
        raise HTTPException(status_code=404, detail="問題が見つかりません")

    existing = (
        db.query(Answer)
        .filter(Answer.participant_id == body.participant_id, Answer.question_id == body.question_id)
        .first()
    )
    if existing is not None:
        return AnswerResult(accepted=False, message="既に回答済みです")

    response_time_ms = int((now - event.answer_started_at).total_seconds() * 1000)
    is_correct = body.choice == question.correct_choice

    answer = Answer(
        participant_id=body.participant_id,
        question_id=body.question_id,
        choice=body.choice,
        answered_at=now,
        response_time_ms=response_time_ms,
        is_correct=is_correct,
    )
    db.add(answer)
    try:
        db.commit()
    except IntegrityError:
        # DB側のユニーク制約による二重回答防止(競合状態のフォールバック)
        db.rollback()
        return AnswerResult(accepted=False, message="既に回答済みです")

    answered_count = db.query(Answer).filter(Answer.question_id == body.question_id).count()
    participant_count = db.query(Participant).filter(Participant.event_id == event_id).count()
    manager.broadcast_all_sync(
        str(event_id),
        {
            "admin": {
                "type": "answer_count_update",
                "answered_count": answered_count,
                "participant_count": participant_count,
            }
        },
    )

    return AnswerResult(accepted=True, is_correct=is_correct, response_time_ms=response_time_ms)
