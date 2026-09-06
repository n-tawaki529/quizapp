interface Props {
  questionText: string;
  /** 残り秒数。ANSWER_OPEN以外では null (既存のMonitor.tsxの表示条件を維持)。 */
  seconds: number | null;
}

/**
 * 会場モニター右側の縦長パネル(Q / 問題文 / 残り時間)。
 * 文章・画像・動画のいずれの問題形式でも共通で使用する。
 */
export default function QuestionInfoPanel({ questionText, seconds }: Props) {
  return (
    <aside className="monitor-question-panel">
      <div className="monitor-qpanel-q">Q</div>
      <div className="monitor-qpanel-text">
        <p>{questionText}</p>
      </div>
      <div className="monitor-qpanel-timer">
        <span className="monitor-qpanel-timer-circle">{seconds ?? ""}</span>
      </div>
    </aside>
  );
}
