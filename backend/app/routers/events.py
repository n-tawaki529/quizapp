from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Event, Participant, Question
from ..schemas import EventAdminDetail, EventCreateRequest, EventPublic
from ..security import require_admin

router = APIRouter(tags=["events"])


def _get_event_or_404(db: Session, event_id: UUID) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="大会が見つかりません")
    return event


# ---- 管理者用 ----
@router.post("/api/admin/events", response_model=EventPublic)
def create_event(body: EventCreateRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    event = Event(name=body.name)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/api/admin/events", response_model=list[EventAdminDetail])
def list_events_admin(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    events = db.query(Event).order_by(Event.created_at.desc()).all()
    result = []
    for e in events:
        current_number = None
        if e.current_question_id:
            q = db.get(Question, e.current_question_id)
            current_number = q.question_number if q else None
        result.append(
            EventAdminDetail(
                id=e.id,
                name=e.name,
                status=e.status,
                phase=e.phase,
                created_at=e.created_at,
                participant_count=db.query(Participant).filter(Participant.event_id == e.id).count(),
                question_count=db.query(Question).filter(Question.event_id == e.id).count(),
                current_question_number=current_number,
            )
        )
    return result


@router.get("/api/admin/events/{event_id}", response_model=EventAdminDetail)
def get_event_admin(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    e = _get_event_or_404(db, event_id)
    current_number = None
    if e.current_question_id:
        q = db.get(Question, e.current_question_id)
        current_number = q.question_number if q else None
    return EventAdminDetail(
        id=e.id,
        name=e.name,
        status=e.status,
        phase=e.phase,
        created_at=e.created_at,
        participant_count=db.query(Participant).filter(Participant.event_id == e.id).count(),
        question_count=db.query(Question).filter(Question.event_id == e.id).count(),
        current_question_number=current_number,
    )


# ---- 公開用(参加者・モニターが大会の基本情報を確認するため) ----
@router.get("/api/events/{event_id}", response_model=EventPublic)
def get_event_public(event_id: UUID, db: Session = Depends(get_db)):
    return _get_event_or_404(db, event_id)
