import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { mediaUrl } from "../api";
import { useEventSocket } from "../useEventSocket";
import { useCountdown } from "../useCountdown";
import { useCanvasScale } from "../useCanvasScale";
import { MonitorState } from "../types";
import ChoiceCard from "../components/monitor/ChoiceCard";
import QuestionInfoPanel from "../components/monitor/QuestionInfoPanel";
import RankingRow from "../components/monitor/RankingRow";

export default function Monitor() {
  const { eventId } = useParams<{ eventId: string }>();
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
    return renderCanvas(
      <>
        <div className="monitor-ranking-board">
          {/* 表示順は state.ranking(バックエンドの compute_ranking が算出した順位)をそのまま使用し、
              フロント側での再計算・再ソートは一切行わない。 */}
          {state.ranking.map((r) => (
            <RankingRow key={r.participant_id} entry={r} />
          ))}
        </div>
        {!connected && <p style={{ color: "#b91c1c" }}>サーバーとの接続が切れています。再接続を試みています...</p>}
      </>,
    );
  }

  const q = state.question;
  // Choiceの content_type が全てTEXTなら文章問題(縦並び)、それ以外(IMAGE/VIDEO)が含まれれば
  // 画像・動画問題(2x2)として扱う。既存のChoiceデータ構造(content_type)をそのまま利用。
  const isMediaChoices = !!q && q.choices.some((c) => c.content_type !== "TEXT");
  const isImageTextChoices =
    !!q && q.question_media_type === "IMAGE" && !!q.question_media_url && q.choices.every((c) => c.content_type === "TEXT");
  let choiceLayoutClass = "monitor-choice-list-text";
  if (isMediaChoices) choiceLayoutClass = "monitor-choice-grid-media";
  if (isImageTextChoices) choiceLayoutClass = "monitor-choice-grid-image-text";
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
