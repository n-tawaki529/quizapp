import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isInvalidParticipantError, participantApi } from "../api";
import { useEventSocket } from "../useEventSocket";
import { useCountdown } from "../useCountdown";
import { clearParticipantSession, getParticipantSession, validateParticipantSession } from "../participantSession";
import { ChoiceKey, ParticipantState } from "../types";

// 会場モニターの問題表示画面と揃えた表示用ラベル(内部的な選択肢キーA〜Dはそのまま、見た目のみ1〜4)。
const CHOICE_LABEL: Record<ChoiceKey, string> = { A: "1", B: "2", C: "3", D: "4" };

export default function Play() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const session = eventId ? getParticipantSession(eventId) : null;

  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<ChoiceKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (eventId && !session) {
      navigate(`/join/${eventId}`, { replace: true });
    }
  }, [eventId, session, navigate]);

  const { state, connected } = useEventSocket<ParticipantState>(eventId, "participant", {
    participantId: session?.participant_id,
  });

  const remainingMs = useCountdown(state?.answer_deadline, state?.server_time);
  const sessionToken = session?.token;

  useEffect(() => {
    if (state?.participant_valid === false && eventId) {
      clearParticipantSession(eventId);
      navigate(`/join/${eventId}`, { replace: true });
    }
  }, [eventId, navigate, state?.participant_valid]);

  useEffect(() => {
    if (!eventId || !sessionToken) return;
    validateParticipantSession(eventId, session)
      .then((valid) => {
        if (!valid) {
          clearParticipantSession(eventId);
          navigate(`/join/${eventId}`, { replace: true });
        }
      })
      .catch(() => undefined);
  }, [eventId, navigate, sessionToken]);

  // 問題が切り替わったら選択状態をリセットする
  useEffect(() => {
    setSelected(state?.already_answered ? state.my_choice : null);
    setErrorMessage(null);
    setLocked(state?.already_answered ?? false);
  }, [state?.question?.id, state?.already_answered, state?.my_choice]);

  if (!eventId || !session) {
    return <div className="page">読み込み中...</div>;
  }

  async function handleAnswer(choice: ChoiceKey) {
    if (!eventId || !session || !state?.question || locked || submitting) return;
    setSubmitting(true);
    try {
      const res = await participantApi.post<{ accepted: boolean; message: string }>(
        `/api/events/${eventId}/answer`,
        {
          participant_id: session.participant_id,
          question_id: state.question.id,
          choice,
        },
        session.token
      );
      if (res.accepted) {
        setErrorMessage(null);
        setLocked(true);
      } else {
        setErrorMessage(res.message || "回答を受け付けられませんでした");
      }
    } catch (err) {
      if (isInvalidParticipantError(err)) {
        clearParticipantSession(eventId);
        navigate(`/join/${eventId}`, { replace: true });
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  const phase = state?.phase ?? "NOT_STARTED";
  const canAnswer = phase === "ANSWER_OPEN" && !locked;
  const seconds = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;
  const feedback = (() => {
    if (phase === "CORRECT_ANSWER_SHOWN" || phase === "RANKING") {
      if (!state?.my_result?.answered) {
        return { text: "未回答", className: "feedback-unanswered" };
      }
      return state.my_result.is_correct
        ? { text: "○ 正解！", className: "feedback-correct" }
        : { text: "× 不正解", className: "feedback-incorrect" };
    }
    if (locked && ["ANSWER_OPEN", "ANSWER_CLOSED", "ANSWER_COUNT_SHOWN"].includes(phase)) {
      return { text: "回答を受け付けました", className: "feedback-accepted" };
    }
    if (phase === "ANSWER_OPEN" && seconds !== null) {
      return { text: `残り ${seconds} 秒`, className: "" };
    }
    return null;
  })();

  return (
    <div className="participant-screen">
      <div className="participant-status-row">
        <p className="correct-count-display">現在の正解数：{state?.correct_count ?? 0}問</p>
        <span className={`conn-indicator ${connected ? "conn-ok" : "conn-bad"}`}>
          {connected ? "接続中" : "再接続中..."}
        </span>
      </div>

      {state?.question ? (
        <p className="question-text">
          {state.question.is_practice ? (
            <span className="practice-badge">練習問題(得点対象外)</span>
          ) : (
            `第${state.question.question_number}問`
          )}
          <br />
          {state.question.question_text}
        </p>
      ) : null}

      <div className="countdown-slot">
        <p className={`countdown ${feedback?.className ?? "countdown-hidden"}`}>
          {feedback?.text ?? "\u00a0"}
        </p>
      </div>

      <div className="choice-grid">
        {state?.question?.choice_keys.map((key) => (
          <button
            key={key}
            className={`choice-btn choice-${key.toLowerCase()} ${selected === key ? "selected" : ""}`}
            disabled={!canAnswer || submitting}
            onClick={() => setSelected(key)}
          >
            {CHOICE_LABEL[key]}
          </button>
        ))}
      </div>

      {canAnswer && (
        <button
          className="btn confirm-answer-btn"
          disabled={selected === null || submitting}
          onClick={() => selected && handleAnswer(selected)}
        >
          回答する
        </button>
      )}

      {errorMessage && <p className="status-message">{errorMessage}</p>}
    </div>
  );
}
