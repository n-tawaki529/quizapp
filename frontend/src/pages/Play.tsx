import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, participantApi } from "../api";
import { useEventSocket } from "../useEventSocket";
import { useCountdown } from "../useCountdown";
import { getParticipantSession } from "../participantSession";
import { ChoiceKey, ParticipantState } from "../types";

const CHOICE_KEYS: ChoiceKey[] = ["A", "B", "C", "D"];

const PHASE_MESSAGE: Record<string, string> = {
  NOT_STARTED: "まもなく大会が始まります。しばらくお待ちください。",
  QUESTION_SHOWN: "会場モニターの問題をご覧ください。まもなく回答が開始されます。",
  ANSWER_CLOSED: "回答受付は終了しました。結果をお待ちください。",
  ANSWER_COUNT_SHOWN: "回答結果発表中です。会場モニターをご覧ください。",
  CORRECT_ANSWER_SHOWN: "正解発表中です。会場モニターをご覧ください。",
  RANKING: "ランキング発表中です。会場モニターをご覧ください。",
};

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
      <span className={`conn-indicator ${connected ? "conn-ok" : "conn-bad"}`}>
        {connected ? "接続中" : "再接続中..."}
      </span>
      <p style={{ color: "#6b7280", fontSize: 13 }}>{session.name} さんとして参加中</p>
      <p className="correct-count-display">現在の正解数：{state?.correct_count ?? 0}問</p>

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
      ) : (
        <p className="question-text">クイズ開始をお待ちください</p>
      )}

      {phase === "ANSWER_OPEN" && seconds !== null && <p className="countdown">残り {seconds} 秒</p>}

      <div className="choice-grid">
        {CHOICE_KEYS.map((key) => (
          <button
            key={key}
            className={`choice-btn choice-${key.toLowerCase()} ${selected === key ? "selected" : ""}`}
            disabled={!canAnswer || submitting}
            onClick={() => setSelected(key)}
          >
            {key}
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
      {!resultMessage && PHASE_MESSAGE[phase] && <p className="status-message">{PHASE_MESSAGE[phase]}</p>}
      {locked && !resultMessage && <p className="status-message">この問題は回答済みです</p>}
    </div>
  );
}
