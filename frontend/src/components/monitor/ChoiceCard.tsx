import { memo } from "react";
import { mediaUrl } from "../../api";
import { ChoiceKey, ChoiceOut } from "../../types";

// 会場モニター専用の色順(参加者スマホ画面の --color-a〜d とは別定義)。
// A/1:青 B/2:赤 C/3:緑 D/4:黄
const COLOR_CLASS: Record<ChoiceKey, string> = { A: "color-a", B: "color-b", C: "color-c", D: "color-d" };
const LABEL: Record<ChoiceKey, string> = { A: "1", B: "2", C: "3", D: "4" };

interface Props {
  choice: ChoiceOut;
  /** "text": 文章問題(縦並び) / "media": 画像・動画問題(2x2) */
  variant: "text" | "media";
  /** 回答人数(ANSWER_COUNT_SHOWN以降のみ)。既存のMonitor.tsxの表示条件をそのまま引き継ぐ。単位は付けず数字のみ表示する。 */
  count?: number | null;
  /** 不正解として全体を暗く表示するか(CORRECT_ANSWER_SHOWN時、正解以外の3択がtrueになる)。 */
  dim?: boolean;
}

function ChoiceCard({ choice, variant, count, dim }: Props) {
  const colorClass = COLOR_CLASS[choice.choice_key];
  const label = LABEL[choice.choice_key];

  return (
    <div
      className={`monitor-choice-card ${variant === "text" ? "text-card" : "media-card"} ${colorClass} ${
        dim ? "dim" : ""
      }`}
    >
      <span className={`monitor-choice-number ${colorClass}`}>{label}</span>
      <span className="monitor-choice-content">
        {choice.content_type === "TEXT" && <span className="monitor-choice-text">{choice.text}</span>}
        {choice.content_type === "IMAGE" && choice.media_url && (
          <div className="monitor-choice-media-wrap">
            <img src={mediaUrl(choice.media_url)} alt="" />
          </div>
        )}
        {choice.content_type === "VIDEO" && choice.media_url && (
          <div className="monitor-choice-media-wrap">
            <video src={mediaUrl(choice.media_url)} muted autoPlay loop />
          </div>
        )}
      </span>
      {count != null && (
        <span className={`monitor-count-badge ${variant === "text" ? "text-badge" : "media-badge"} ${colorClass}`}>
          {count}
        </span>
      )}
    </div>
  );
}

// countdown(100ms間隔)での再レンダリング時にvideo要素が無意味に再生成されないよう、
// props(choiceオブジェクトの参照など)が変わらない限り再レンダリングをスキップする。
export default memo(ChoiceCard);
