from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..schemas import MediaUploadResponse
from ..security import require_admin
from ..storage import get_media_storage

router = APIRouter(prefix="/api/admin/media", tags=["media"])

ALLOWED_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
}


@router.post("/upload", response_model=MediaUploadResponse)
def upload_media(file: UploadFile = File(...), _admin=Depends(require_admin)):
    suffix = Path(file.filename or "").suffix.lower()
    expected_content_type = ALLOWED_MEDIA_TYPES.get(suffix)
    if expected_content_type is None or file.content_type != expected_content_type:
        raise HTTPException(
            status_code=415,
            detail="JPEG、PNG、WebP、MP4、MP3のみアップロードできます(拡張子とMIME typeが一致する必要があります)",
        )
    storage = get_media_storage()
    try:
        url = storage.save(file)
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    return MediaUploadResponse(url=url)
