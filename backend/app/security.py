from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from .config import get_settings

settings = get_settings()

_bearer = HTTPBearer(auto_error=False)


def _create_token(data: dict, expires_minutes: int) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_admin_token() -> str:
    return _create_token({"role": "admin"}, settings.admin_token_expire_minutes)


def create_participant_token(participant_id: UUID, event_id: UUID) -> str:
    return _create_token(
        {"role": "participant", "participant_id": str(participant_id), "event_id": str(event_id)},
        settings.participant_token_expire_minutes,
    )


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="無効なトークンです")


def require_admin(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="認証が必要です")
    payload = _decode(credentials.credentials)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="管理者権限が必要です")
    return payload


def require_participant(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="認証が必要です")
    payload = _decode(credentials.credentials)
    if payload.get("role") != "participant":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="参加者権限が必要です")
    return payload
