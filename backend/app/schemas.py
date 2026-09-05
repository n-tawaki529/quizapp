from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from .models import ChoiceContentType, ChoiceKey, EventStatus, MediaType, QuizPhase


# ---------- Admin auth ----------
class AdminLoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    token: str
    token_type: str = "bearer"


# ---------- Events ----------
class EventCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class EventPublic(BaseModel):
    id: UUID
    name: str
    status: EventStatus
    phase: QuizPhase
    created_at: datetime

    class Config:
        from_attributes = True


class EventAdminDetail(EventPublic):
    participant_count: int
    question_count: int
    current_question_number: int | None = None


# ---------- Choices ----------
class ChoiceInput(BaseModel):
    choice_key: ChoiceKey
    content_type: ChoiceContentType = ChoiceContentType.TEXT
    text: str | None = None
    media_url: str | None = None


class ChoiceOut(BaseModel):
    choice_key: ChoiceKey
    content_type: ChoiceContentType
    text: str | None = None
    media_url: str | None = None

    class Config:
        from_attributes = True


# ---------- Questions ----------
class QuestionCreateRequest(BaseModel):
    question_number: int
    question_text: str
    question_media_type: MediaType = MediaType.NONE
    question_media_url: str | None = None
    time_limit_seconds: int = 10
    correct_choice: ChoiceKey
    choices: list[ChoiceInput]
    is_practice: bool = False


class QuestionUpdateRequest(BaseModel):
    question_number: int | None = None
    question_text: str | None = None
    question_media_type: MediaType | None = None
    question_media_url: str | None = None
    time_limit_seconds: int | None = None
    correct_choice: ChoiceKey | None = None
    choices: list[ChoiceInput] | None = None
    is_practice: bool | None = None


class QuestionAdminOut(BaseModel):
    id: UUID
    question_number: int
    question_text: str
    question_media_type: MediaType
    question_media_url: str | None
    time_limit_seconds: int
    correct_choice: ChoiceKey
    choices: list[ChoiceOut]
    is_practice: bool

    class Config:
        from_attributes = True


class ReorderRequest(BaseModel):
    question_ids: list[UUID]


# ---------- Participants ----------
class JoinRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class JoinResponse(BaseModel):
    participant_id: UUID
    token: str
    name: str
    event_id: UUID


# ---------- Answers ----------
class AnswerRequest(BaseModel):
    participant_id: UUID
    question_id: UUID
    choice: ChoiceKey


class AnswerResult(BaseModel):
    accepted: bool
    is_correct: bool | None = None
    response_time_ms: int | None = None
    message: str = ""


# ---------- Ranking ----------
class RankingEntry(BaseModel):
    rank: int
    participant_id: UUID
    name: str
    correct_count: int
    total_response_time_ms: int


class RankingResponse(BaseModel):
    entries: list[RankingEntry]


# ---------- Media ----------
class MediaUploadResponse(BaseModel):
    url: str
