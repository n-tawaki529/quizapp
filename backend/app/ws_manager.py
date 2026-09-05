import asyncio
import json
import logging
from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import WebSocket

logger = logging.getLogger(__name__)


def _json_default(obj: Any):
    if isinstance(obj, UUID):
        return str(obj)
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "value"):  # Enum
        return obj.value
    return str(obj)


class ConnectionManager:
    """イベントごと・ロールごとにWebSocket接続を管理し、ブロードキャストする。

    注意: 現状はシングルプロセス内のメモリで管理している。
    複数プロセス/複数インスタンスでスケールする場合は Redis Pub/Sub 等の
    メッセージブローカーを介した配信に置き換える必要がある(README参照)。
    """

    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, set[WebSocket]]] = defaultdict(lambda: defaultdict(set))
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def broadcast_all_sync(self, event_id: str, messages_by_role: dict[str, dict]) -> None:
        """同期(スレッドプールで実行される)エンドポイントから安全にブロードキャストを予約する。"""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast_all(event_id, messages_by_role), self._loop)

    def schedule_sync(self, coro) -> None:
        """同期コンテキストからバックグラウンドの非同期タスク(自動締切処理等)を予約する。"""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(coro, self._loop)

    async def connect(self, event_id: str, role: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms[event_id][role].add(ws)

    async def disconnect(self, event_id: str, role: str, ws: WebSocket) -> None:
        async with self._lock:
            self._rooms[event_id][role].discard(ws)

    async def send_to(self, ws: WebSocket, message: dict) -> None:
        try:
            await ws.send_text(json.dumps(message, default=_json_default))
        except Exception:
            logger.debug("failed to send message to a websocket", exc_info=True)

    async def broadcast_role(self, event_id: str, role: str, message: dict) -> None:
        conns = list(self._rooms.get(event_id, {}).get(role, set()))
        payload = json.dumps(message, default=_json_default)
        dead = []
        for ws in conns:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._rooms[event_id][role].discard(ws)

    async def broadcast_all(self, event_id: str, messages_by_role: dict[str, dict]) -> None:
        for role, message in messages_by_role.items():
            await self.broadcast_role(event_id, role, message)

    def count(self, event_id: str, role: str) -> int:
        return len(self._rooms.get(event_id, {}).get(role, set()))


manager = ConnectionManager()
