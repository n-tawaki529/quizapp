import { memo } from "react";
import { RankingEntry } from "../../types";

/**
 * 正解した問題の回答時間合計(ミリ秒)を "M分SS秒mmm" 形式にフォーマットする。
 * ここでの ms は既存のランキング判定に使用している total_response_time_ms を
 * そのまま表示用に整形するだけで、値そのものの計算(正解判定・時間集計)は行わない。
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${minutes}分${String(seconds).padStart(2, "0")}秒${String(millis).padStart(3, "0")}`;
}

interface Props {
  readonly entry: RankingEntry;
  readonly revealed: boolean;
  readonly highlighted: boolean;
}

function RankingRow({ entry, revealed, highlighted }: Props) {
  const isFirst = revealed && entry.rank === 1;
  const rowClassName = [
    "monitor-ranking-row",
    revealed ? "is-revealed" : "is-hidden",
    highlighted ? "is-highlighted" : "",
    isFirst ? "is-first" : "",
    isFirst && highlighted ? "is-winner-reveal" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={rowClassName}>
      <span className="monitor-ranking-rank">{entry.rank}</span>
      {revealed ? (
        <>
          <span className="monitor-ranking-name" title={entry.name}>
            {entry.name}
          </span>
          <span className="monitor-ranking-correct">{entry.correct_count}問</span>
          <span className="monitor-ranking-time">{formatDuration(entry.total_response_time_ms)}</span>
        </>
      ) : (
        <>
          <span className="monitor-ranking-name" />
          <span className="monitor-ranking-correct" />
          <span className="monitor-ranking-time" />
        </>
      )}
    </div>
  );
}

export default memo(RankingRow);
