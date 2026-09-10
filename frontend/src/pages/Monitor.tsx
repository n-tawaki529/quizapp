import type { ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { mediaUrl } from "../api";
import { useEventSocket } from "../useEventSocket";
import { useCountdown } from "../useCountdown";
import { useCanvasScale } from "../useCanvasScale";
import { MonitorState, RankingEntry } from "../types";
import ChoiceCard from "../components/monitor/ChoiceCard";
import QuestionInfoPanel from "../components/monitor/QuestionInfoPanel";
import RankingRow from "../components/monitor/RankingRow";

// 開発時の10行レイアウト確認専用。URLから明示的に有効化した場合だけ使う。
const DEBUG_RANKING: RankingEntry[] = [
  { rank: 1, participant_id: "debug-01", name: "山田太郎", correct_count: 10, total_response_time_ms: 12345 },
  { rank: 2, participant_id: "debug-02", name: "テストユーザー02", correct_count: 9, total_response_time_ms: 14210 },
  { rank: 3, participant_id: "debug-03", name: "佐藤", correct_count: 9, total_response_time_ms: 16580 },
  { rank: 4, participant_id: "debug-04", name: "かなり長めの表示名テスト", correct_count: 8, total_response_time_ms: 18432 },
  { rank: 5, participant_id: "debug-05", name: "鈴木一郎", correct_count: 8, total_response_time_ms: 20123 },
  { rank: 6, participant_id: "debug-06", name: "User-0006", correct_count: 7, total_response_time_ms: 22456 },
  { rank: 7, participant_id: "debug-07", name: "あいうえおかきくけこ", correct_count: 6, total_response_time_ms: 25120 },
  { rank: 8, participant_id: "debug-08", name: "田中", correct_count: 5, total_response_time_ms: 27890 },
  { rank: 9, participant_id: "debug-09", name: "participant09", correct_count: 4, total_response_time_ms: 30111 },
  { rank: 10, participant_id: "debug-10", name: "最下位テスト", correct_count: 3, total_response_time_ms: 33450 },
];

export default function Monitor() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const { state, connected } = useEventSocket<MonitorState>(eventId, "monitor");
  const remainingMs = useCountdown(state?.answer_deadline, state?.server_time);
  const seconds = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;
  const scale = useCanvasScale();

  const renderCanvas = (content: ReactNode) => (
    <div className="monitor-viewport">
      <div className="monitor-canvas" style={{ transform: `scale(${scale})` }}>
        {content}
      </div>
    </div>
  );

  if (!state) {
    return renderCanvas("接続中...");
  }

  if (state.phase === "RANKING" && state.ranking) {
    const ranking = searchParams.get("debugRanking") === "10" ? DEBUG_RANKING : state.ranking;
    const revealRank = state.ranking_reveal_rank;
    const isComplete = revealRank === 0;

    return renderCanvas(
      <>
        <h1 className="monitor-ranking-heading">最終ランキング</h1>
        <div className="monitor-ranking-board">
          {ranking.map((r) => (
            <RankingRow
              key={r.participant_id}
              entry={r}
              revealed={isComplete || (revealRank !== null && r.rank >= revealRank)}
              highlighted={revealRank !== null && revealRank > 0 && r.rank === revealRank}
            />
          ))}
        </div>
        {!connected && <p style={{ color: "#b91c1c" }}>サーバーとの接続が切れています。再接続を試みています...</p>}
      </>,
    );
  }

  if (state.phase === "QUESTION_TRANSITION") {
    let title = "";
    if (state.transition_is_practice) {
      title = "練習問題";
    } else if (state.transition_question_number !== null) {
      title = `第${state.transition_question_number}問`;
    }
    return renderCanvas(
      <div className="monitor-transition">
        <h1 className="monitor-transition-title">{title}</h1>
      </div>,
    );
  }

  const q = state.question;
  // Choiceの content_type が全てTEXTなら文章問題(縦並び)、それ以外は選択肢数別のグリッドにする。
  const isMediaChoices = !!q && q.choices.some((c) => c.content_type !== "TEXT");
  const isImageTextChoices =
    !!q && q.question_media_type === "IMAGE" && !!q.question_media_url && q.choices.every((c) => c.content_type === "TEXT");
  let choiceLayoutClass = "monitor-choice-list-text";
  if (isMediaChoices) {
    const choiceCount = q?.choices.length ?? 4;
    choiceLayoutClass = choiceCount === 4 ? "monitor-choice-grid-media" : `monitor-choice-grid-media-${choiceCount}`;
  }
  if (isImageTextChoices) {
    const choiceCount = q?.choices.length ?? 4;
    choiceLayoutClass =
      choiceCount === 4 ? "monitor-choice-grid-image-text" : `monitor-choice-grid-image-text-${choiceCount}`;
  }
  // answer_deadline が設定されている(=一度でも回答受付を開始した)間はタイマーを表示する。
  // ANSWER_OPEN中は残り秒数、受付終了後は締切を過ぎているため useCountdown が自然に0を返す。
  // QUESTION_SHOWN(まだ回答受付前)は answer_deadline が null のため非表示のまま(既存仕様通り)。
  const showTimer = state.answer_deadline !== null;

  return renderCanvas(
    <>
      {!connected && <p style={{ color: "#b91c1c" }}>サーバーとの接続が切れています。再接続を試みています...</p>}
      {!q && <h1 className="monitor-question-text">{state.event_name ?? "クイズ大会"}</h1>}
      {q && (
        <>
          {q.question_media_type === "IMAGE" && q.question_media_url && !isImageTextChoices && (
            <img className="monitor-media" src={mediaUrl(q.question_media_url)} />
          )}
          {q.question_media_type === "VIDEO" && q.question_media_url && (
            <video className="monitor-media" src={mediaUrl(q.question_media_url)} controls autoPlay />
          )}

          <div className={`monitor-main${isImageTextChoices ? " monitor-main-image-text" : ""}`}>
            <div className={`monitor-choices-area${isImageTextChoices ? " monitor-choices-area-image-text" : ""}`}>
              {isImageTextChoices && q.question_media_url && (
                <div className="monitor-image-text-media-frame">
                  <img className="monitor-image-text-media" src={mediaUrl(q.question_media_url)} alt="" />
                </div>
              )}
              <div className={choiceLayoutClass}>
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
    </>,
  );
}
