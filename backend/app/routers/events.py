import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Choice, Event, EventStatus, Participant, Question, QuizPhase
from ..quiz_state import build_admin_state, build_monitor_state, build_participant_state
from ..schemas import EventAdminDetail, EventCreateRequest, EventPublic
from ..security import require_admin
from ..storage import get_media_storage
from ..ws_manager import manager

router = APIRouter(tags=["events"])

logger = logging.getLogger(__name__)


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


@router.post("/api/admin/events/{event_id}/duplicate", response_model=EventAdminDetail)
def duplicate_event(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """大会を複製する。

    複製されるのは大会名・問題・選択肢(正解・制限時間・メディア・並び順を含む)のみ。
    参加者・回答記録・実行状態(進行フェーズ)・ランキング結果は複製せず、
    複製後の大会は新しいIDを持つ独立した「未開始」の大会として作成される。
    """
    source = _get_event_or_404(db, event_id)
    questions = (
        db.query(Question)
        .options(selectinload(Question.choices))
        .filter(Question.event_id == event_id)
        .order_by(Question.question_number)
        .all()
    )

    storage = get_media_storage()

    def _copy_media(url: str | None) -> str | None:
        if not url:
            return None
        try:
            return storage.copy(url)
        except Exception:
            logger.warning(
                "メディアファイルの複製に失敗したため、元のURLをそのまま使用します: %s", url, exc_info=True
            )
            return url

    suffix = "（コピー）"
    base_name = source.name
    if len(base_name) + len(suffix) > 200:
        base_name = base_name[: 200 - len(suffix)]
    new_event = Event(name=f"{base_name}{suffix}")
    db.add(new_event)
    db.flush()  # new_event.id を確定させる

    for q in questions:
        new_question = Question(
            event_id=new_event.id,
            question_number=q.question_number,
            question_text=q.question_text,
            question_media_type=q.question_media_type,
            question_media_url=_copy_media(q.question_media_url),
            time_limit_seconds=q.time_limit_seconds,
            correct_choice=q.correct_choice,
        )
        for c in q.choices:
            new_question.choices.append(
                Choice(
                    choice_key=c.choice_key,
                    content_type=c.content_type,
                    text=c.text,
                    media_url=_copy_media(c.media_url),
                )
            )
        db.add(new_question)

    db.commit()
    db.refresh(new_event)

    return EventAdminDetail(
        id=new_event.id,
        name=new_event.name,
        status=new_event.status,
        phase=new_event.phase,
        created_at=new_event.created_at,
        participant_count=0,
        question_count=len(questions),
        current_question_number=None,
    )


@router.post("/api/admin/events/{event_id}/reset", response_model=EventAdminDetail)
def reset_event(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """大会をリセットし、同じ問題セットで再度実施できる状態に戻す。

    問題・選択肢・メディア・設定はそのまま残し、参加者・回答記録・ランキング結果のみ削除する。
    大会の状態は CREATED / NOT_STARTED に戻り、QRコードから新たに参加者が参加できるようになる。
    """
    event = _get_event_or_404(db, event_id)

    # participants を削除すると DB の ondelete=CASCADE により紐づく answers も連鎖削除される。
    db.query(Participant).filter(Participant.event_id == event_id).delete(synchronize_session=False)

    event.current_question_id = None
    event.phase = QuizPhase.NOT_STARTED
    event.status = EventStatus.CREATED
    event.answer_started_at = None
    event.answer_deadline = None
    db.commit()
    db.refresh(event)

    _broadcast_current_state(db, event)

    question_count = db.query(Question).filter(Question.event_id == event_id).count()
    return EventAdminDetail(
        id=event.id,
        name=event.name,
        status=event.status,
        phase=event.phase,
        created_at=event.created_at,
        participant_count=0,
        question_count=question_count,
        current_question_number=None,
    )


@router.delete("/api/admin/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: UUID, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """大会を削除する。

    問題・選択肢・参加者・回答記録は全て削除する(DB制約・ORMカスケードにより連鎖削除)。
    問題・選択肢に紐づくメディアファイルもストレージから削除し、孤児ファイルを残さない。
    """
    event = _get_event_or_404(db, event_id)

    questions = (
        db.query(Question)
        .options(selectinload(Question.choices))
        .filter(Question.event_id == event_id)
        .all()
    )
    media_urls: list[str] = []
    for q in questions:
        if q.question_media_url:
            media_urls.append(q.question_media_url)
        for c in q.choices:
            if c.media_url:
                media_urls.append(c.media_url)

    # events.current_question_id が questions.id を参照しているため、
    # 問題行を削除する前に参照を外しておかないとFK制約違反になる。
    event.current_question_id = None
    db.flush()

    db.delete(event)
    db.commit()

    storage = get_media_storage()
    for url in media_urls:
        try:
            storage.delete(url)
        except Exception:
            logger.warning("メディアファイルの削除に失敗しました: %s", url, exc_info=True)

    return None


# ---- 公開用(参加者・モニターが大会の基本情報を確認するため) ----
@router.get("/api/events/{event_id}", response_model=EventPublic)
def get_event_public(event_id: UUID, db: Session = Depends(get_db)):
    return _get_event_or_404(db, event_id)
