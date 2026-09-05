from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://quizuser:quizpass@localhost:5432/quizapp"

    # 管理者認証。本番運用ではより強固な認証方式(OAuth等)への差し替えを推奨。
    admin_password: str = "admin123"
    jwt_secret: str = "dev-secret-change-me-in-production"
    jwt_algorithm: str = "HS256"
    admin_token_expire_minutes: int = 60 * 12
    participant_token_expire_minutes: int = 60 * 12

    # メディアストレージ。local -> ローカルディスク保存。将来 s3 に切り替え可能な構造にする。
    media_storage_backend: str = "local"
    media_local_dir: str = "./media"
    media_base_url: str = "/media"

    # S3移行時に使用する設定 (media_storage_backend=s3 の場合)
    s3_bucket: str = ""
    s3_region: str = ""

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    default_time_limit_seconds: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
