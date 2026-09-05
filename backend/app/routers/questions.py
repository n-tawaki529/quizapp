from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Choice, ChoiceKey, Event, Question
from ..schemas import QuestionAdminOut, QuestionCreateRequest, QuestionUpdateRequest, ReorderRequest
from ..security import require_admin

router = APIRouter(prefix="/api/admin/events/{event_id}/questions", tags=["questions"])

MAX_QUESTIONS_PER_EVENT = 10
REQUIRED_CHOICE_KEYS = {ChoiceKey.A, ChoiceKey.B, ChoiceKey.C, ChoiceKey.D}


def _get_event_or_404(db: Session, event_id: UUID) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="大会が見つかりません")
    return event


def _validate_choices(choices: list) -> None:
    keys = {c.choice_key for c in choices}
    if keys != REQUIRED_CHOICE_KEYS:
        raise HTTPException(status_code=422, detail="選択肢はA〜Dをすべて指定してください")


@router.get("", response_model=list[QuestionAdminOut])
def list_questions(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    _get_event_or_404(db, event_id)
    questions = (
        db.query(Question)
        .options(selectinload(Question.choices))
        .filter(Question.event_id == event_id)
        .order_by(Question.question_number)
        .all()
    )
    return questions


@router.post("", response_model=QuestionAdminOut)
def create_question(
    event_id: UUID, body: QuestionCreateRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)
):
    _get_event_or_404(db, event_id)
    _validate_choices(body.choices)

    count = db.query(Question).filter(Question.event_id == event_id).count()
    if count >= MAX_QUESTIONS_PER_EVENT:
        raise HTTPException(status_code=422, detail=f"1大会につき最大{MAX_QUESTIONS_PER_EVENT}問までです")

    existing = (
        db.query(Question)
        .filter(Question.event_id == event_id, Question.question_number == body.question_number)
        .first()
    )
    if existing:
        raise HTTPException(status_code=422, detail="同じ問題番号がすでに存在します")

    question = Question(
        event_id=event_id,
        question_number=body.question_number,
        question_text=body.question_text,
        question_media_type=body.question_media_type,
        question_media_url=body.question_media_url,
        time_limit_seconds=body.time_limit_seconds,
        correct_choice=body.correct_choice,
    )
    for c in body.choices:
        question.choices.append(
            Choice(choice_key=c.choice_key, content_type=c.content_type, text=c.text, media_url=c.media_url)
        )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.put("/{question_id}", response_model=QuestionAdminOut)
def update_question(
    event_id: UUID,
    question_id: UUID,
    body: QuestionUpdateRequest,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    _get_event_or_404(db, event_id)
    question = db.get(Question, question_id)
    if question is None or question.event_id != event_id:
        raise HTTPException(status_code=404, detail="問題が見つかりません")

    if body.question_number is not None and body.question_number != question.question_number:
        existing = (
            db.query(Question)
            .filter(
                Question.event_id == event_id,
                Question.question_number == body.question_number,
                Question.id != question_id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=422, detail="同じ問題番号がすでに存在します")
        question.question_number = body.question_number

    if body.question_text is not None:
        question.question_text = body.question_text
    if body.question_media_type is not None:
        question.question_media_type = body.question_media_type
    if body.question_media_url is not None:
        question.question_media_url = body.question_media_url
    if body.time_limit_seconds is not None:
        question.time_limit_seconds = body.time_limit_seconds
    if body.correct_choice is not None:
        question.correct_choice = body.correct_choice

    if body.choices is not None:
        _validate_choices(body.choices)
        by_key = {c.choice_key: c for c in question.choices}
        for c in body.choices:
            target = by_key.get(c.choice_key)
            if target:
                target.content_type = c.content_type
                target.text = c.text
                target.media_url = c.media_url

    db.commit()
    db.refresh(question)
    return question


@router.delete("/{question_id}", status_code=204)
def delete_question(
    event_id: UUID, question_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)
):
    _get_event_or_404(db, event_id)
    question = db.get(Question, question_id)
    if question is None or question.event_id != event_id:
        raise HTTPException(status_code=404, detail="問題が見つかりません")
    db.delete(question)
    db.commit()
    return None


@router.put("/reorder/apply", response_model=list[QuestionAdminOut])
def reorder_questions(
    event_id: UUID, body: ReorderRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)
):
    _get_event_or_404(db, event_id)
    questions = db.query(Question).filter(Question.event_id == event_id).all()
    by_id = {q.id: q for q in questions}
    if set(by_id.keys()) != set(body.question_ids):
        raise HTTPException(status_code=422, detail="問題IDの一覧が一致しません")

    # 一旦重複を避けるため大きなオフセット番号にしてからコミット
    offset = 10000
    for q in questions:
        q.question_number += offset
    db.flush()
    for idx, qid in enumerate(body.question_ids, start=1):
        by_id[qid].question_number = idx
    db.commit()

    result = (
        db.query(Question)
        .options(selectinload(Question.choices))
        .filter(Question.event_id == event_id)
        .order_by(Question.question_number)
        .all()
    )
    return result
