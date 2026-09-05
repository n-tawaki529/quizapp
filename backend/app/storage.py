"""
メディアストレージの抽象化レイヤー。

開発初期はローカルディスクに保存するが、将来 AWS S3 等のオブジェクトストレージへ
差し替えやすいように `MediaStorage` インターフェースを介して利用する。
`settings.media_storage_backend` を "s3" に変更し `S3MediaStorage` を実装・接続するだけで
アプリケーションの他の部分(ルーター等)には変更を加えずに移行できる。
"""
from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from pathlib import Path

from fastapi import UploadFile

from .config import get_settings

settings = get_settings()


class MediaStorage(ABC):
    @abstractmethod
    def save(self, file: UploadFile) -> str:
        """ファイルを保存し、クライアントからアクセス可能なURL(パス)を返す。"""
        raise NotImplementedError


class LocalMediaStorage(MediaStorage):
    def __init__(self, base_dir: str, base_url: str):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.base_url = base_url.rstrip("/")

    def save(self, file: UploadFile) -> str:
        suffix = Path(file.filename or "").suffix
        filename = f"{uuid.uuid4().hex}{suffix}"
        dest = self.base_dir / filename
        with dest.open("wb") as out:
            while chunk := file.file.read(1024 * 1024):
                out.write(chunk)
        return f"{self.base_url}/{filename}"


class S3MediaStorage(MediaStorage):
    """
    将来の AWS S3 移行用のプレースホルダー実装。
    boto3 を利用し、put_object でアップロードして公開URL(または署名付きURL)を返す想定。
    """

    def __init__(self, bucket: str, region: str):
        self.bucket = bucket
        self.region = region

    def save(self, file: UploadFile) -> str:
        raise NotImplementedError(
            "S3MediaStorage は未実装です。boto3 を利用したアップロード処理を実装してください。"
        )


def get_media_storage() -> MediaStorage:
    if settings.media_storage_backend == "s3":
        return S3MediaStorage(settings.s3_bucket, settings.s3_region)
    return LocalMediaStorage(settings.media_local_dir, settings.media_base_url)
