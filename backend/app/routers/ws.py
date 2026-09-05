from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt

from ..config import get_settings
from ..database import SessionLocal
from ..models import Event
from ..quiz_state import build_admin_state, build_monitor_state, build_participant_state
from ..ws_manager import manager

router = APIRouter(tags=["websocket"])
settings = get_settings()


def _build_initial_state(event_id: UUID, role: str, participant_id: UUID | None):
    db = SessionLocal()
    try:
        event = db.get(Event, event_id)
        if event is None:
            return None
        if role == "monitor":
            return build_monitor_state(db, event)
        if role == "admin":
            return build_admin_state(db, event)
        return build_participant_state(db, event, participant_id)
    finally:
        db.close()


@router.websocket("/ws/events/{event_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    event_id: UUID,
    role: str = Query(default="participant"),
    token: str | None = Query(default=None),
    participant_id: UUID | None = Query(default=None),
):
    if role not in ("monitor", "participant", "admin"):
        await websocket.close(code=4000)
        return

    if role == "admin":
        # 管理者用WebSocketはトークン必須で保護する
        if not token:
            await websocket.close(code=4401)
            return
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        except JWTError:
            await websocket.close(code=4401)
            return
        if payload.get("role") != "admin":
            await websocket.close(code=4403)
            return

    await manager.connect(str(event_id), role, websocket, str(participant_id) if participant_id else None)
    try:
        initial_state = _build_initial_state(event_id, role, participant_id)
        if initial_state is None:
            await websocket.close(code=4404)
            return
        await manager.send_to(websocket, initial_state)

        while True:
            # クライアントからのメッセージは特に処理しない(keepalive/ping用途)。
            # 切断検知のために受信を待ち続ける。
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(str(event_id), role, websocket)
