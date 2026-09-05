from fastapi import APIRouter, HTTPException, status

from ..config import get_settings
from ..schemas import AdminLoginRequest, TokenResponse
from ..security import create_admin_token

router = APIRouter(prefix="/api/admin", tags=["admin-auth"])
settings = get_settings()


@router.post("/login", response_model=TokenResponse)
def login(body: AdminLoginRequest):
    if body.password != settings.admin_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="パスワードが正しくありません")
    return TokenResponse(token=create_admin_token())
