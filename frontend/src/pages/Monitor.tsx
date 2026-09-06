import { useParams } from "react-router-dom";
import { mediaUrl } from "../api";
import { useEventSocket } from "../useEventSocket";
import { useCountdown } from "../useCountdown";
import { MonitorState } from "../types";
import ChoiceCard from "../components/monitor/ChoiceCard";
import QuestionInfoPanel from "../components/monitor/QuestionInfoPanel";

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
        {!connected && <p style={{ color: "#b91c1c" }}>サーバーとの接続が切れています。再接続を試みています...</p>}
      </div>
    );
  }

  const q = state.question;
  // Choiceの content_type が全てTEXTなら文章問題(縦並び)、それ以外(IMAGE/VIDEO)が含まれれば
  // 画像・動画問題(2x2)として扱う。既存のChoiceデータ構造(content_type)をそのまま利用。
  const isMediaChoices = !!q && q.choices.some((c) => c.content_type !== "TEXT");
  // answer_deadline が設定されている(=一度でも回答受付を開始した)間はタイマーを表示する。
  // ANSWER_OPEN中は残り秒数、受付終了後は締切を過ぎているため useCountdown が自然に0を返す。
  // QUESTION_SHOWN(まだ回答受付前)は answer_deadline が null のため非表示のまま(既存仕様通り)。
  const showTimer = state.answer_deadline !== null;

  return (
    <div className="monitor-screen">
      {!connected && <p style={{ color: "#b91c1c" }}>サーバーとの接続が切れています。再接続を試みています...</p>}
      {!q && <h1 className="monitor-question-text">{state.event_name ?? "クイズ大会"}</h1>}
      {q && (
        <>
          <p className="monitor-status-bar">
            {q.is_practice ? <span className="practice-badge">練習問題(得点対象外)</span> : `第${q.question_number}問`}
            {state.phase === "ANSWER_CLOSED" && <span>回答受付終了</span>}
            {state.phase === "ANSWER_COUNT_SHOWN" && <span>回答結果発表</span>}
            {state.phase === "CORRECT_ANSWER_SHOWN" && state.correct_choice && <span>正解は　{state.correct_choice}</span>}
          </p>

          {q.question_media_type === "IMAGE" && q.question_media_url && (
            <img className="monitor-media" src={mediaUrl(q.question_media_url)} />
          )}
          {q.question_media_type === "VIDEO" && q.question_media_url && (
            <video className="monitor-media" src={mediaUrl(q.question_media_url)} controls autoPlay />
          )}

          <div className="monitor-main">
            <div className="monitor-choices-area">
              <div className={isMediaChoices ? "monitor-choice-grid-media" : "monitor-choice-list-text"}>
                {q.choices.map((c) => (
                  <ChoiceCard
                    key={c.choice_key}
                    choice={c}
                    variant={isMediaChoices ? "media" : "text"}
                    count={
                      state.answer_counts &&
                      (state.phase === "ANSWER_COUNT_SHOWN" || state.phase === "CORRECT_ANSWER_SHOWN")
                        ? state.answer_counts[c.choice_key]
                        : null
                    }
                    dim={
                      state.phase === "CORRECT_ANSWER_SHOWN" &&
                      state.correct_choice !== null &&
                      state.correct_choice !== c.choice_key
                    }
                  />
                ))}
              </div>
            </div>
            <QuestionInfoPanel questionText={q.question_text} seconds={showTimer ? seconds : null} />
          </div>
        </>
      )}
    </div>
  );
}
