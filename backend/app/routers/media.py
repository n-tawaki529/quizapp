from fastapi import APIRouter, Depends, File, UploadFile

from ..schemas import MediaUploadResponse
from ..security import require_admin
from ..storage import get_media_storage

router = APIRouter(prefix="/api/admin/media", tags=["media"])


@router.post("/upload", response_model=MediaUploadResponse)
def upload_media(file: UploadFile = File(...), _admin=Depends(require_admin)):
    storage = get_media_storage()
    url = storage.save(file)
    return MediaUploadResponse(url=url)
