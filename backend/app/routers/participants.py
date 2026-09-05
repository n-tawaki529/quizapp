from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Event, Participant
from ..schemas import JoinRequest, JoinResponse
from ..security import create_participant_token

router = APIRouter(prefix="/api/events/{event_id}", tags=["participants"])


@router.post("/join", response_model=JoinResponse)
def join_event(event_id: UUID, body: JoinRequest, db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="大会が見つかりません")
    if event.status.value == "FINISHED":
        raise HTTPException(status_code=422, detail="この大会は終了しています")

    # 名前の重複は許可する。participant_id (UUID) をユーザー識別子として発行する。
    participant = Participant(event_id=event_id, name=body.name)
    db.add(participant)
    db.commit()
    db.refresh(participant)

    token = create_participant_token(participant.id, event_id)
    return JoinResponse(participant_id=participant.id, token=token, name=participant.name, event_id=event_id)
