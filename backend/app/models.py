import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Enum as SAEnum
from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EventStatus(str, enum.Enum):
    CREATED = "CREATED"
    WAITING = "WAITING"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"


class QuizPhase(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"        # まだ問題が出題されていない
    QUESTION_SHOWN = "QUESTION_SHOWN"  # 問題表示中、回答受付前
    ANSWER_OPEN = "ANSWER_OPEN"        # 回答受付中
    ANSWER_CLOSED = "ANSWER_CLOSED"    # 回答受付終了(まだ結果は見せない)
    ANSWER_COUNT_SHOWN = "ANSWER_COUNT_SHOWN"  # 各選択肢の回答人数を表示中(正解はまだ非公開)
    CORRECT_ANSWER_SHOWN = "CORRECT_ANSWER_SHOWN"  # 正解発表済み
    RANKING = "RANKING"                # ランキング表示中


class MediaType(str, enum.Enum):
    NONE = "NONE"
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"


class ChoiceContentType(str, enum.Enum):
    TEXT = "TEXT"
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"


class ChoiceKey(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"


def uuid_pk():
    return mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[EventStatus] = mapped_column(
        SAEnum(EventStatus, name="event_status"), default=EventStatus.CREATED, nullable=False
    )

    current_question_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("questions.id", use_alter=True, name="fk_event_current_question"), nullable=True
    )
    phase: Mapped[QuizPhase] = mapped_column(
        SAEnum(QuizPhase, name="quiz_phase"), default=QuizPhase.NOT_STARTED, nullable=False
    )
    answer_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    answer_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    questions: Mapped[list["Question"]] = relationship(
        "Question", back_populates="event", cascade="all, delete-orphan",
        foreign_keys="Question.event_id", order_by="Question.question_number",
    )
    participants: Mapped[list["Participant"]] = relationship(
        "Participant", back_populates="event", cascade="all, delete-orphan"
    )


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (UniqueConstraint("event_id", "question_number", name="uq_question_event_number"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    event_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    question_number: Mapped[int] = mapped_column(Integer, nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_media_type: Mapped[MediaType] = mapped_column(
        SAEnum(MediaType, name="question_media_type"), default=MediaType.NONE, nullable=False
    )
    question_media_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    time_limit_seconds: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    correct_choice: Mapped[ChoiceKey] = mapped_column(SAEnum(ChoiceKey, name="choice_key_correct"), nullable=False)
    is_practice: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    event: Mapped["Event"] = relationship("Event", back_populates="questions", foreign_keys=[event_id])
    choices: Mapped[list["Choice"]] = relationship(
        "Choice", back_populates="question", cascade="all, delete-orphan", order_by="Choice.choice_key"
    )


class Choice(Base):
    __tablename__ = "choices"
    __table_args__ = (UniqueConstraint("question_id", "choice_key", name="uq_choice_question_key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    question_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    choice_key: Mapped[ChoiceKey] = mapped_column(SAEnum(ChoiceKey, name="choice_key"), nullable=False)
    content_type: Mapped[ChoiceContentType] = mapped_column(
        SAEnum(ChoiceContentType, name="choice_content_type"), default=ChoiceContentType.TEXT, nullable=False
    )
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    question: Mapped["Question"] = relationship("Question", back_populates="choices")


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[uuid.UUID] = uuid_pk()
    event_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    event: Mapped["Event"] = relationship("Event", back_populates="participants")


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("participant_id", "question_id", name="uq_answer_participant_question"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    participant_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("participants.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    choice: Mapped[ChoiceKey] = mapped_column(SAEnum(ChoiceKey, name="choice_key_answer"), nullable=False)
    answered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    response_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    is_correct: Mapped[bool] = mapped_column(nullable=False)
