import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, isInvalidParticipantError, participantApi } from "../api";
import { useEventSocket } from "../useEventSocket";
import { useCountdown } from "../useCountdown";
import { clearParticipantSession, getParticipantSession, validateParticipantSession } from "../participantSession";
import { ChoiceKey, ParticipantState } from "../types";

const CHOICE_KEYS: ChoiceKey[] = ["A", "B", "C", "D"];
// 会場モニターの問題表示画面と揃えた表示用ラベル(内部的な選択肢キーA〜Dはそのまま、見た目のみ1〜4)。
const CHOICE_LABEL: Record<ChoiceKey, string> = { A: "1", B: "2", C: "3", D: "4" };

export default function Play() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const session = eventId ? getParticipantSession(eventId) : null;

  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<ChoiceKey | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
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
    setSelected(null);
    setResultMessage(null);
    setLocked(state?.already_answered ?? false);
  }, [state?.question?.id]);

  useEffect(() => {
    if (state?.already_answered) setLocked(true);
  }, [state?.already_answered]);

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
        setResultMessage("回答を受け付けました");
        setLocked(true);
      } else {
        setResultMessage(res.message || "回答を受け付けられませんでした");
        setLocked(true);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (isInvalidParticipantError(err)) {
          clearParticipantSession(eventId);
          navigate(`/join/${eventId}`, { replace: true });
          return;
        }
        setResultMessage(err.message);
      } else {
        setResultMessage("通信エラーが発生しました");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const phase = state?.phase ?? "NOT_STARTED";
  const canAnswer = phase === "ANSWER_OPEN" && !locked;
  const seconds = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;

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
        <p className={`countdown${phase === "ANSWER_OPEN" && seconds !== null ? "" : " countdown-hidden"}`}>
          {phase === "ANSWER_OPEN" && seconds !== null ? `残り ${seconds} 秒` : "\u00a0"}
        </p>
      </div>

      <div className="choice-grid">
        {CHOICE_KEYS.map((key) => (
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

      <button
        className="btn confirm-answer-btn"
        disabled={!canAnswer || selected === null || submitting}
        onClick={() => selected && handleAnswer(selected)}
      >
        回答する
      </button>

      {resultMessage && <p className="status-message">{resultMessage}</p>}
      {locked && !resultMessage && <p className="status-message">この問題は回答済みです</p>}
    </div>
  );
}
