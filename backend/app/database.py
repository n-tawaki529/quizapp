from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def pool_status() -> dict[str, int | str]:
    """SQLAlchemy QueuePoolの現在の使用状況を、新規connectionを取得せず安全に取得する。"""
    pool = engine.pool
    try:
        return {
            "checkedout": pool.checkedout(),
            "size": pool.size(),
            "overflow": pool.overflow(),
        }
    except AttributeError:
        return {"checkedout": "-", "size": "-", "overflow": "-"}
