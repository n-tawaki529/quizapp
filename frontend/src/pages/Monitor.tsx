import { useParams } from "react-router-dom";
import { mediaUrl } from "../api";
import { useEventSocket } from "../useEventSocket";
import { useCountdown } from "../useCountdown";
import { MonitorState } from "../types";

const CHOICE_CLASS: Record<string, string> = { A: "choice-a", B: "choice-b", C: "choice-c", D: "choice-d" };

export default function Monitor() {
  const { eventId } = useParams<{ eventId: string }>();
  const { state, connected } = useEventSocket<MonitorState>(eventId, "monitor");
  const remainingMs = useCountdown(state?.answer_deadline, state?.server_time);
  const seconds = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;

  if (!state) {
    return <div className="monitor-screen">接続中...</div>;
  }

  if (state.phase === "RANKING" && state.ranking) {
    return (
      <div className="monitor-screen">
        <h1>ランキング TOP 5</h1>
        <table className="monitor-ranking-table">
          <thead>
            <tr>
              <th>順位</th>
              <th>名前</th>
              <th>正答数</th>
              <th>合計回答時間</th>
            </tr>
          </thead>
          <tbody>
            {state.ranking.map((r) => (
              <tr key={r.participant_id}>
                <td>{r.rank}</td>
                <td>{r.name}</td>
                <td>{r.correct_count}問</td>
                <td>{(r.total_response_time_ms / 1000).toFixed(3)}秒</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!connected && <p style={{ color: "#f87171" }}>サーバーとの接続が切れています。再接続を試みています...</p>}
      </div>
    );
  }

  const q = state.question;

  return (
    <div className="monitor-screen">
      {!connected && <p style={{ color: "#f87171" }}>サーバーとの接続が切れています。再接続を試みています...</p>}
      {!q && <h1>{state.event_name ?? "クイズ大会"}</h1>}
      {q && (
        <>
          <p style={{ opacity: 0.7, fontSize: 24 }}>第{q.question_number}問</p>
          <p className="monitor-question-text">{q.question_text}</p>
          {q.question_media_type === "IMAGE" && q.question_media_url && (
            <img className="monitor-media" src={mediaUrl(q.question_media_url)} />
          )}
          {q.question_media_type === "VIDEO" && q.question_media_url && (
            <video className="monitor-media" src={mediaUrl(q.question_media_url)} controls autoPlay />
          )}

          {state.phase === "ANSWER_OPEN" && seconds !== null && <p className="monitor-countdown">{seconds}</p>}
          {state.phase === "ANSWER_CLOSED" && <p style={{ fontSize: 36, fontWeight: 800 }}>回答受付終了</p>}

          <div className="monitor-choice-grid">
            {q.choices.map((c) => (
              <div key={c.choice_key} className={`monitor-choice ${CHOICE_CLASS[c.choice_key]}`}>
                <span>{c.choice_key}</span>
                {c.content_type === "TEXT" && <span>{c.text}</span>}
                {c.content_type === "IMAGE" && c.media_url && <img src={mediaUrl(c.media_url)} />}
                {c.content_type === "VIDEO" && c.media_url && <video src={mediaUrl(c.media_url)} muted autoPlay loop />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
