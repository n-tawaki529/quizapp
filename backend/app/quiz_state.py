"""
現在のクイズ状態をロール(monitor / participant / admin)ごとに異なる形式で
組み立てるためのヘルパー。

重要な仕様:
- 参加者(スマートフォン)には問題・選択肢のメディアや選択肢テキストを一切送らない。
  問題文と A〜D のキーだけを送り、ボタンの有効/無効や解答済みかどうかを伝える。
- 会場モニターには問題文・メディア・選択肢の内容をすべて送る。
- 正解(correct_choice)はランキング表示以外のどの状態にも含めない。
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Answer, Event, EventQuestionState, Participant, Question, QuizPhase
from .config import get_settings


settings = get_settings()


def get_effective_correct_choice(db: Session, event: Event, question: Question):
    if not question.dynamic_correct_answer:
        return question.correct_choice
    run_state = (
        db.query(EventQuestionState)
        .filter(EventQuestionState.event_id == event.id, EventQuestionState.question_id == question.id)
        .first()
    )
    return run_state.correct_choice if run_state else None


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def compute_ranking(db: Session, event_id: UUID, limit: int | None = 5) -> list[dict]:
    """正答数の多い順、次に正解問題の合計回答時間が短い順にランキングを算出する。

    練習問題(is_practice=True)への回答は集計対象外とする。
    """
    rows = (
        db.query(
            Answer.participant_id,
            func.count(Answer.id).filter(Answer.is_correct.is_(True)).label("correct_count"),
            func.coalesce(
                func.sum(Answer.response_time_ms).filter(Answer.is_correct.is_(True)), 0
            ).label("total_time_ms"),
        )
        .join(Question, Question.id == Answer.question_id)
        .filter(Answer.participant_id.in_(select(Participant.id).where(Participant.event_id == event_id)))
        .filter(Question.is_practice.is_(False))
        .group_by(Answer.participant_id)
        .all()
    )

    participants = {p.id: p for p in db.query(Participant).filter(Participant.event_id == event_id).all()}

    # 未回答の参加者(正答0件)も含める場合は下位に来るため、集計に出てこなくても順位対象にする
    result = []
    seen_ids = set()
    for row in rows:
        seen_ids.add(row.participant_id)
        p = participants.get(row.participant_id)
        if p is None:
            continue
        result.append(
            {
                "participant_id": p.id,
                "name": p.name,
                "correct_count": int(row.correct_count or 0),
                "total_response_time_ms": int(row.total_time_ms or 0),
            }
        )
    for pid, p in participants.items():
        if pid not in seen_ids:
            result.append(
                {"participant_id": p.id, "name": p.name, "correct_count": 0, "total_response_time_ms": 0}
            )

    # 正答数降順、合計時間昇順、participant_id昇順(安定した順序のため)
    result.sort(key=lambda r: (-r["correct_count"], r["total_response_time_ms"], str(r["participant_id"])))

    ranked = []
    for i, r in enumerate(result):
        ranked.append({**r, "rank": i + 1})
    return ranked if limit is None else ranked[:limit]


def compute_participant_final_rank(
    db: Session, event_id: UUID, participant_id: UUID, full_ranking: list[dict] | None = None
) -> int | None:
    ranking = full_ranking if full_ranking is not None else compute_ranking(db, event_id, limit=None)
    for entry in ranking:
        if entry["participant_id"] == participant_id:
            return entry["rank"]
    return None


def compute_fastest_correct_answer(db: Session, question_id: UUID) -> dict | None:
    answer = (
        db.query(Answer, Participant)
        .join(Participant, Participant.id == Answer.participant_id)
        .filter(Answer.question_id == question_id, Answer.is_correct.is_(True))
        .order_by(Answer.response_time_ms.asc(), Answer.answered_at.asc(), Answer.participant_id.asc())
        .first()
    )
    if answer is None:
        return None

    answer_row, participant = answer
    return {
        "participant_id": participant.id,
        "name": participant.name,
        "response_time_ms": answer_row.response_time_ms,
    }


def compute_answer_counts(db: Session, question_id: UUID) -> dict:
    """指定した問題について、選択肢ごとに「回答するボタンを押して確定した」参加者数を集計する。

    Answer テーブルには確定済みの回答のみが保存されるため(選択しただけの状態はDBに残らない)、
    このテーブルをそのまま集計すればよい。
    """
    question = db.get(Question, question_id)
    counts = {choice.choice_key.value: 0 for choice in question.choices} if question else {}
    rows = (
        db.query(Answer.choice, func.count(Answer.id))
        .filter(Answer.question_id == question_id)
        .group_by(Answer.choice)
        .all()
    )
    for choice, cnt in rows:
        if choice.value in counts:
            counts[choice.value] = int(cnt)
    return counts


def compute_participant_correct_count(db: Session, event: Event, participant_id: UUID | None) -> int:
    """参加者自身の確定済み正解数を計算する。

    現在表示・回答受付中の問題(正解がまだ会場に発表されていない問題)は含めない。
    正解発表(CORRECT_ANSWER_SHOWN)以降、または既に次の問題へ進んでいる場合にカウント対象になる。
    途中参加者は参加後に回答した問題のAnswerしか持たないため、自然に「参加後の問題だけ」が対象になる。
    """
    if participant_id is None:
        return 0
    query = (
        db.query(Answer)
        .join(Question, Question.id == Answer.question_id)
        .filter(
            Answer.participant_id == participant_id,
            Answer.is_correct.is_(True),
            Question.is_practice.is_(False),
        )
    )
    if event.current_question_id is not None and event.phase not in (
        QuizPhase.CORRECT_ANSWER_SHOWN,
        QuizPhase.RANKING,
    ):
        query = query.filter(Answer.question_id != event.current_question_id)
    return query.count()


def build_choice_out(choice, include_reveal_text: bool = False) -> dict:
    result = {
        "choice_key": choice.choice_key.value,
        "content_type": choice.content_type.value,
        "text": choice.text,
        "media_url": choice.media_url,
    }
    if include_reveal_text:
        result["reveal_text"] = choice.reveal_text
    return result


def build_monitor_state(db: Session, event: Event, include_question_details: bool = False) -> dict:
    question = None
    if event.current_question_id:
        question = db.get(Question, event.current_question_id)

    now = datetime.now(timezone.utc)
    remaining_ms = None
    if event.phase.value == "ANSWER_OPEN" and event.answer_deadline:
        remaining_ms = max(0, int((event.answer_deadline - now).total_seconds() * 1000))

    state = {
        "type": "state_sync",
        "role": "monitor",
        "event_id": str(event.id),
        "event_name": event.name,
        "event_status": event.status.value,
        "phase": event.phase.value,
        "answer_started_at": _iso(event.answer_started_at),
        "answer_deadline": _iso(event.answer_deadline),
        "remaining_ms": remaining_ms,
        "server_time": _iso(now),
        "question": None,
        "ranking": None,
        "ranking_reveal_rank": None,
        "answer_counts": None,
        "correct_choice": None,
        "transition_question_number": None,
        "transition_is_practice": None,
        "pre_media": None,
    }
    if question:
        state["transition_question_number"] = question.question_number
        state["transition_is_practice"] = question.is_practice
        if event.phase not in (QuizPhase.QUESTION_TRANSITION, QuizPhase.PRE_QUESTION_MEDIA) or include_question_details:
            question_state = {
                "id": str(question.id),
                "question_number": question.question_number,
                "question_text": question.question_text,
                "question_media_type": question.question_media_type.value,
                "question_media_url": question.question_media_url,
                "time_limit_seconds": question.time_limit_seconds,
                "choices": [
                    build_choice_out(
                        c,
                        include_reveal_text=include_question_details
                        or event.phase == QuizPhase.CORRECT_ANSWER_SHOWN,
                    )
                    for c in question.choices
                ],
                "is_practice": question.is_practice,
            }
            if include_question_details:
                question_state.update(
                    {
                        "pre_question_media_type": question.pre_question_media_type.value,
                        "pre_question_media_url": question.pre_question_media_url,
                        "pre_correct_media_type": question.pre_correct_media_type.value,
                        "pre_correct_media_url": question.pre_correct_media_url,
                    }
                )
            state["question"] = question_state
        if event.phase in (QuizPhase.ANSWER_COUNT_SHOWN, QuizPhase.PRE_CORRECT_MEDIA, QuizPhase.CORRECT_ANSWER_SHOWN):
            state["answer_counts"] = compute_answer_counts(db, question.id)
        if event.phase == QuizPhase.CORRECT_ANSWER_SHOWN:
            correct_choice = get_effective_correct_choice(db, event, question)
            state["correct_choice"] = correct_choice.value if correct_choice else None
        if event.phase == QuizPhase.PRE_QUESTION_MEDIA:
            state["pre_media"] = {
                "media_type": question.pre_question_media_type.value,
                "media_url": question.pre_question_media_url,
                "timing": "before_question",
            }
        elif event.phase == QuizPhase.PRE_CORRECT_MEDIA:
            state["pre_media"] = {
                "media_type": question.pre_correct_media_type.value,
                "media_url": question.pre_correct_media_url,
                "timing": "before_correct_answer",
            }
    if event.phase.value == "RANKING":
        state["ranking"] = compute_ranking(db, event.id, limit=settings.ranking_display_limit)
        state["ranking_reveal_rank"] = event.ranking_reveal_rank
    return state


def build_participant_state(
    db: Session,
    event: Event,
    participant_id: UUID | None = None,
    full_ranking: list[dict] | None = None,
) -> dict:
    question = None
    if event.current_question_id:
        question = db.get(Question, event.current_question_id)

    now = datetime.now(timezone.utc)
    remaining_ms = None
    if event.phase.value == "ANSWER_OPEN" and event.answer_deadline:
        remaining_ms = max(0, int((event.answer_deadline - now).total_seconds() * 1000))

    answer = None
    if question is not None and participant_id is not None:
        answer = (
            db.query(Answer)
            .filter(Answer.participant_id == participant_id, Answer.question_id == question.id)
            .first()
        )
    already_answered = answer is not None
    result_visible = event.phase in (QuizPhase.CORRECT_ANSWER_SHOWN, QuizPhase.RANKING)
    my_result = None
    if result_visible:
        my_result = {
            "answered": answer is not None,
        }
        if answer is not None:
            my_result.update(
                {
                    "choice_key": answer.choice.value,
                    "is_correct": answer.is_correct,
                }
            )

    reveal_complete = event.phase == QuizPhase.RANKING and event.ranking_reveal_rank == 0
    final_rank = None
    if reveal_complete and participant_id is not None:
        final_rank = compute_participant_final_rank(db, event.id, participant_id, full_ranking)

    state = {
        "type": "state_sync",
        "role": "participant",
        "event_id": str(event.id),
        "phase": event.phase.value,
        "answer_deadline": _iso(event.answer_deadline),
        "remaining_ms": remaining_ms,
        "server_time": _iso(now),
        "question": None,
        "participant_valid": participant_id is not None and db.get(Participant, participant_id) is not None,
        "already_answered": already_answered,
        "my_choice": answer.choice.value if answer is not None else None,
        "my_result": my_result,
        "correct_count": compute_participant_correct_count(db, event, participant_id),
        "final_rank": final_rank,
        "transition_question_number": None,
        "transition_is_practice": None,
    }
    if question:
        state["transition_question_number"] = question.question_number
        state["transition_is_practice"] = question.is_practice
        if event.phase not in (
            QuizPhase.QUESTION_TRANSITION,
            QuizPhase.PRE_QUESTION_MEDIA,
            QuizPhase.PRE_CORRECT_MEDIA,
        ):
            state["question"] = {
                "id": str(question.id),
                "question_number": question.question_number,
                "question_text": question.question_text,
                "choice_keys": [c.choice_key.value for c in question.choices],
                "is_practice": question.is_practice,
            }
    return state


def build_admin_state(db: Session, event: Event) -> dict:
    from .ws_manager import manager

    state = build_monitor_state(db, event, include_question_details=True)
    state["role"] = "admin"
    state["participant_count"] = db.query(Participant).filter(Participant.event_id == event.id).count()
    answered_count = 0
    if event.current_question_id:
        answered_count = db.query(Answer).filter(Answer.question_id == event.current_question_id).count()
    state["answered_count"] = answered_count
    state["connected_participant_count"] = manager.count(str(event.id), "participant")
    # クイズ進行画面に常時表示するランキング上位5名(人数が0でもエラーにならない)。
    state["top_ranking"] = compute_ranking(db, event.id, limit=5)
    if event.current_question_id:
        question = db.get(Question, event.current_question_id)
        if question:
            correct_choice = get_effective_correct_choice(db, event, question)
            state["admin_correct_choice"] = correct_choice.value if correct_choice else None
            state["admin_correct_choice_set"] = correct_choice is not None
            state["admin_dynamic_correct_answer"] = question.dynamic_correct_answer
            if event.phase not in (
                QuizPhase.NOT_STARTED,
                QuizPhase.QUESTION_TRANSITION,
                QuizPhase.PRE_QUESTION_MEDIA,
                QuizPhase.QUESTION_SHOWN,
                QuizPhase.ANSWER_OPEN,
            ) and correct_choice is not None:
                state["fastest_correct_answer"] = compute_fastest_correct_answer(db, question.id)
            else:
                state["fastest_correct_answer"] = None
    else:
        state["admin_correct_choice"] = None
        state["admin_correct_choice_set"] = False
        state["admin_dynamic_correct_answer"] = False
        state["fastest_correct_answer"] = None
    return state
