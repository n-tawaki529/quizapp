import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { adminApi, getAdminToken, mediaUrl } from "../api";
import { useEventSocket } from "../useEventSocket";
import { EventAdminDetail, MonitorState, QuestionAdminOut } from "../types";
import QuestionForm from "./QuestionForm";

const PHASE_LABEL: Record<string, string> = {
  NOT_STARTED: "未開始",
  QUESTION_TRANSITION: "問題切替",
  PRE_QUESTION_MEDIA: "出題前メディア表示中",
  QUESTION_SHOWN: "回答待機中",
  ANSWER_OPEN: "回答受付中",
  ANSWER_CLOSED: "回答受付終了",
  ANSWER_COUNT_SHOWN: "回答人数表示中",
  PRE_CORRECT_MEDIA: "正解発表前メディア表示中",
  CORRECT_ANSWER_SHOWN: "正解発表済み",
  RANKING: "ランキング表示中",
};

function getNextQuestion(currentQuestion: QuestionAdminOut | null, questions: QuestionAdminOut[]) {
  let nextQuestionNumber = 1;
  if (currentQuestion) {
    nextQuestionNumber = currentQuestion.question_number + 1;
  } else if (questions.some((q) => q.is_practice)) {
    nextQuestionNumber = 0;
  }
  return questions.find((q) => q.question_number === nextQuestionNumber) ?? null;
}

function getMediaLabel(mediaType: string | undefined) {
  return mediaType && mediaType !== "NONE" ? mediaType : "なし";
}

function QuestionPreview({
  title,
  question,
  emptyMessage = "次の問題はありません",
}: {
  readonly title: string;
  readonly question: QuestionAdminOut | null;
  readonly emptyMessage?: string;
}) {
  if (!question) {
    return (
      <section className="admin-question-preview admin-question-preview-empty">
        <h3>{title}</h3>
        <p>{emptyMessage}</p>
      </section>
    );
  }

  const correctChoice = question.choices.find((choice) => choice.choice_key === question.correct_choice);

  return (
    <section className="admin-question-preview">
      <div className="admin-preview-heading">
        <h3>{title}</h3>
        <strong>{getQuestionLabel(question)}</strong>
      </div>
      <p className="admin-preview-question-text">{question.question_text}</p>
      {question.question_media_type === "IMAGE" && question.question_media_url && (
        <img className="admin-preview-image" src={mediaUrl(question.question_media_url)} alt="問題画像" />
      )}
      <div className="admin-preview-meta">
        <span>制限時間: {question.time_limit_seconds}秒</span>
        <span>
          正解: {question.correct_choice}{" "}
          {correctChoice?.content_type === "TEXT"
            ? correctChoice.text
            : <span className="admin-media-badge">{correctChoice?.content_type ?? "メディア"}</span>}
        </span>
      </div>
      <ul className="admin-preview-choices">
        {question.choices.map((choice) => (
          <li key={choice.choice_key}>
            <strong>{choice.choice_key}.</strong>{" "}
            {choice.content_type === "TEXT" ? choice.text : (
              <>
                <span className="admin-media-badge">{choice.content_type}</span>
                {choice.content_type === "IMAGE" && choice.media_url && (
                  <img className="admin-choice-thumbnail" src={mediaUrl(choice.media_url)} alt={`${choice.choice_key}の画像`} />
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="admin-preview-media">
        <strong>メディア</strong>
        <span>問題表示中: {getMediaLabel(question.question_media_type)}</span>
        <span>出題前: {getMediaLabel(question.pre_question_media_type)}</span>
        <span>正解発表前: {getMediaLabel(question.pre_correct_media_type)}</span>
      </div>
    </section>
  );
}

function getNextActionLabel(phase: string, hasNext: boolean, question: MonitorState["question"]) {
  const labels: Record<string, string> = {
    NOT_STARTED: "次の問題へ",
    QUESTION_TRANSITION: "問題を表示＋回答開始",
    QUESTION_SHOWN: "回答開始",
    ANSWER_OPEN: "回答締切待ち",
    ANSWER_CLOSED: "回答結果を表示",
    ANSWER_COUNT_SHOWN: "正解発表",
    RANKING: "終了",
  };
  if (phase === "QUESTION_TRANSITION" && question?.pre_question_media_type && question.pre_question_media_type !== "NONE") {
    return "出題前メディアを表示";
  }
  if (phase === "ANSWER_COUNT_SHOWN" && question?.pre_correct_media_type && question.pre_correct_media_type !== "NONE") {
    return "正解発表前メディアを表示";
  }
  if (phase === "PRE_QUESTION_MEDIA") return "問題を表示＋回答開始";
  if (phase === "PRE_CORRECT_MEDIA") return "正解発表";
  if (phase === "CORRECT_ANSWER_SHOWN") return hasNext ? "次の問題へ" : "ランキング表示";
  return labels[phase] ?? "終了";
}

function getQuestionLabel(question: MonitorState["question"]) {
  if (!question) return "問題未表示";
  return question.is_practice ? "練習問題" : `第${question.question_number}問`;
}

function getRankingRevealActionLabel(rank: number | null) {
  if (rank === null) return "最初の順位を表示";
  if (rank === 1) return "最終ランキングを表示";
  return "次の順位を表示";
}

function getRankingRevealNextLabel(rank: number | null) {
  if (rank === null) return "最初の順位を表示";
  if (rank === 1) return "最終ランキングを表示";
  return `第${rank - 1}位を表示`;
}

function getRankingRevealStatus(rank: number | null) {
  if (rank === null) return "ランキング発表の開始待ちです。";
  if (rank === 1) return "現在: 第1位を表示中 / 次: 最終ランキング";
  return `現在: 第${rank}位を表示中 / 次: 第${rank - 1}位`;
}

export default function AdminEvent() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"questions" | "quiz" | "qr">("questions");
  const [event, setEvent] = useState<EventAdminDetail | null>(null);
  const [questions, setQuestions] = useState<QuestionAdminOut[]>([]);
  const [editing, setEditing] = useState<QuestionAdminOut | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { state, connected } = useEventSocket<MonitorState>(eventId, "admin", {
    token: getAdminToken(),
  });

  async function loadEvent() {
    if (!eventId) return;
    const e = await adminApi.get<EventAdminDetail>(`/api/admin/events/${eventId}`);
    setEvent(e);
  }

  async function loadQuestions() {
    if (!eventId) return;
    const qs = await adminApi.get<QuestionAdminOut[]>(`/api/admin/events/${eventId}/questions`);
    setQuestions(qs);
  }

  useEffect(() => {
    loadEvent();
    loadQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function handleDelete(q: QuestionAdminOut) {
    if (!eventId) return;
    const label = q.is_practice ? "練習問題" : `第${q.question_number}問`;
    if (!window.confirm(`${label}を削除しますか?`)) return;
    await adminApi.delete(`/api/admin/events/${eventId}/questions/${q.id}`);
    await loadQuestions();
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!eventId) return;
    const newOrder = [...normalQuestions];
    const target = index + direction;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    await adminApi.put(`/api/admin/events/${eventId}/questions/reorder/apply`, {
      question_ids: newOrder.map((q) => q.id),
    });
    await loadQuestions();
  }

  async function runAction(action: () => Promise<unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadEvent();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEvent() {
    if (!eventId) return;
    if (!window.confirm("この大会を削除しますか？ この操作は元に戻せません。")) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.delete(`/api/admin/events/${eventId}`);
      navigate("/admin");
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleDuplicateEvent() {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi.post<EventAdminDetail>(`/api/admin/events/${eventId}/duplicate`);
      navigate(`/admin/events/${created.id}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!eventId || !event) {
    return <div className="page">読み込み中...</div>;
  }

  const joinUrl = `${window.location.origin}/join/${eventId}`;
  const monitorUrl = `${window.location.origin}/monitor/${eventId}`;
  const practiceQuestion = questions.find((q) => q.is_practice) ?? null;
  const normalQuestions = questions.filter((q) => !q.is_practice);
  const phase = state?.phase ?? event.phase;
  const currentQuestion = state?.question ?? null;
  const currentQuestionDetails = questions.find((q) => q.id === currentQuestion?.id) ?? null;
  const nextQuestionDetails = getNextQuestion(currentQuestionDetails, questions);
  const hasMoreQuestions = nextQuestionDetails !== null;
  const rankingRevealRank = state?.ranking_reveal_rank ?? null;
  const nextActionLabel = phase === "RANKING"
    ? getRankingRevealNextLabel(rankingRevealRank)
    : getNextActionLabel(phase, hasMoreQuestions, currentQuestion);
  const hasPreQuestionMedia = currentQuestion?.pre_question_media_type !== undefined && currentQuestion.pre_question_media_type !== "NONE";
  const hasPreCorrectMedia = currentQuestion?.pre_correct_media_type !== undefined && currentQuestion.pre_correct_media_type !== "NONE";
  const interruptAnswerConfirm =
    phase === "ANSWER_OPEN"
      ? "回答受付中です。進めると現在の回答受付が中断されます。よろしいですか?"
      : "次の問題へ進みます。よろしいですか?";

  const showQuestion = () =>
    runAction(
      () => adminApi.post(`/api/admin/events/${eventId}/show-question`),
      phase === "QUESTION_TRANSITION" && hasPreQuestionMedia
        ? "出題前メディアを表示せず、問題を表示します。よろしいですか?"
        : "問題内容を会場モニターに表示します。よろしいですか?"
    );
  const showQuestionAndStartAnswer = () =>
    runAction(
      () => adminApi.post(`/api/admin/events/${eventId}/show-question-and-start-answer`),
      phase === "QUESTION_TRANSITION" && hasPreQuestionMedia
        ? "出題前メディアを表示せず、問題を表示して回答受付を開始します。よろしいですか?"
        : "問題を表示して回答受付を開始します。よろしいですか?"
    );
  const showPreQuestionMedia = () =>
    runAction(() => adminApi.post(`/api/admin/events/${eventId}/show-pre-question-media`), "出題前メディアを表示します。よろしいですか?");
  const nextQuestion = () =>
    runAction(() => adminApi.post(`/api/admin/events/${eventId}/next`), interruptAnswerConfirm);
  const startAnswer = () =>
    runAction(
      () => adminApi.post(`/api/admin/events/${eventId}/start-answer`),
      "回答受付を開始します。よろしいですか?"
    );
  const nextAndStartAnswer = () =>
    runAction(
      () => adminApi.post(`/api/admin/events/${eventId}/next-and-start-answer`),
      phase === "ANSWER_OPEN"
        ? interruptAnswerConfirm
        : "次の問題へ進み、同時に回答受付を開始します。よろしいですか?"
    );
  const showAnswerCount = () =>
    runAction(
      () => adminApi.post(`/api/admin/events/${eventId}/show-answer-count`),
      "回答人数を会場モニターに表示します。よろしいですか?"
    );
  const showCorrectAnswer = () =>
    runAction(
      () => adminApi.post(`/api/admin/events/${eventId}/show-correct-answer`),
      phase === "ANSWER_COUNT_SHOWN" && hasPreCorrectMedia
        ? "正解発表前メディアを表示せず、正解を発表します。よろしいですか?"
        : "正解を発表します。よろしいですか?"
    );
  const showPreCorrectMedia = () =>
    runAction(() => adminApi.post(`/api/admin/events/${eventId}/show-pre-correct-media`), "正解発表前メディアを表示します。よろしいですか?");
  const showRanking = () =>
    runAction(
      () => adminApi.post(`/api/admin/events/${eventId}/show-ranking`),
      "会場モニターをランキング表示に切り替えます。よろしいですか?"
    );
  const showNextRankingReveal = () =>
    runAction(() => adminApi.post(`/api/admin/events/${eventId}/ranking-reveal-next`));

  return (
    <div className="page">
      <h1>{event.name}</h1>
      <div className="row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <div className="row">
          <span className="badge">{event.status}</span>
          <span>
            {PHASE_LABEL[event.phase] ?? event.phase}
            {event.current_question_number ? ` (第${event.current_question_number}問)` : ""}
          </span>
        </div>
        <div className="row">
          <button className="btn secondary" disabled={busy} onClick={handleDuplicateEvent}>
            大会を複製
          </button>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() =>
              runAction(
                () => adminApi.post(`/api/admin/events/${eventId}/reset`),
                "この大会をリセットしますか？\n参加者・回答記録・ランキング結果は削除され、元に戻せません。"
              )
            }
          >
            大会をリセット
          </button>
          <button className="btn danger" disabled={busy} onClick={handleDeleteEvent}>
            大会を削除
          </button>
        </div>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <div className="tabs">
        <button className={`tab ${tab === "questions" ? "active" : ""}`} onClick={() => setTab("questions")}>
          問題管理
        </button>
        <button className={`tab ${tab === "quiz" ? "active" : ""}`} onClick={() => setTab("quiz")}>
          クイズ進行
        </button>
        <button className={`tab ${tab === "qr" ? "active" : ""}`} onClick={() => setTab("qr")}>
          QRコード
        </button>
      </div>

      {tab === "questions" && (
        <div>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>問題一覧({questions.length}/10)</h2>
              {questions.length < 10 && editing === null && (
                <button className="btn" onClick={() => setEditing("new")}>
                  問題を追加
                </button>
              )}
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>問題文</th>
                  <th>制限時間</th>
                  <th>正解</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {practiceQuestion && (
                  <tr key={practiceQuestion.id} style={{ background: "#fef3c7" }}>
                    <td>
                      <span className="practice-badge">練習</span>
                    </td>
                    <td>{practiceQuestion.question_text}</td>
                    <td>{practiceQuestion.time_limit_seconds}秒</td>
                    <td>{practiceQuestion.correct_choice}</td>
                    <td className="row">
                      <button className="btn secondary" onClick={() => setEditing(practiceQuestion)}>
                        編集
                      </button>
                      <button className="btn danger" onClick={() => handleDelete(practiceQuestion)}>
                        削除
                      </button>
                    </td>
                  </tr>
                )}
                {normalQuestions.map((q, idx) => (
                  <tr key={q.id}>
                    <td>{q.question_number}</td>
                    <td>{q.question_text}</td>
                    <td>{q.time_limit_seconds}秒</td>
                    <td>{q.correct_choice}</td>
                    <td className="row">
                      <button className="btn secondary" onClick={() => handleMove(idx, -1)} disabled={idx === 0}>
                        ↑
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => handleMove(idx, 1)}
                        disabled={idx === normalQuestions.length - 1}
                      >
                        ↓
                      </button>
                      <button className="btn secondary" onClick={() => setEditing(q)}>
                        編集
                      </button>
                      <button className="btn danger" onClick={() => handleDelete(q)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
                {questions.length === 0 && (
                  <tr>
                    <td colSpan={5}>問題がまだ登録されていません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {editing !== null && (
            <QuestionForm
              eventId={eventId}
              initial={editing === "new" ? null : editing}
              nextQuestionNumber={normalQuestions.length + 1}
              hasPracticeQuestion={practiceQuestion !== null}
              onSaved={async () => {
                setEditing(null);
                await loadQuestions();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </div>
      )}

      {tab === "quiz" && (
        <div className="card">
          <h2>クイズ進行</h2>
          <p>
            WebSocket接続:{" "}
            <span className={connected ? "conn-ok" : "conn-bad"} style={{ padding: "2px 8px", borderRadius: 999 }}>
              {connected ? "接続中" : "切断"}
            </span>
          </p>
          <div className="admin-state-summary">
            <div className="admin-state-item">
              <span className="admin-state-label">現在の問題</span>
              <strong className="admin-state-value">
                {getQuestionLabel(currentQuestion)}
              </strong>
            </div>
            <div className="admin-state-item">
              <span className="admin-state-label">現在の状態</span>
              <strong className="admin-state-value">{PHASE_LABEL[phase] ?? "-"}</strong>
            </div>
            <div className="admin-state-item">
              <span className="admin-state-label">次の操作</span>
              <strong className="admin-state-value">{nextActionLabel}</strong>
            </div>
          </div>
          <div className="admin-state-counts">
            <span>参加者数: {state?.participant_count ?? "-"}</span>
            <span>接続中: {state?.connected_participant_count ?? "-"}</span>
            <span>回答数: {state?.answered_count ?? "-"}</span>
          </div>
          <div className="admin-main-action">
            {phase === "NOT_STARTED" && <button className="btn" disabled={busy} onClick={nextQuestion}>次の問題へ</button>}
            {phase === "QUESTION_TRANSITION" && (
              hasPreQuestionMedia
                ? <button className="btn" disabled={busy} onClick={showPreQuestionMedia}>出題前メディアを表示</button>
                : <button className="btn" disabled={busy} onClick={showQuestionAndStartAnswer}>問題を表示＋回答開始</button>
            )}
            {phase === "PRE_QUESTION_MEDIA" && <button className="btn" disabled={busy} onClick={showQuestionAndStartAnswer}>問題を表示＋回答開始</button>}
            {phase === "QUESTION_SHOWN" && <button className="btn" disabled={busy} onClick={startAnswer}>回答開始</button>}
            {phase === "ANSWER_OPEN" && <p className="admin-waiting-message">回答受付中です。制限時間終了後に自動で締め切ります。</p>}
            {phase === "ANSWER_CLOSED" && <button className="btn" disabled={busy} onClick={showAnswerCount}>回答結果を表示</button>}
            {phase === "ANSWER_COUNT_SHOWN" && (
              hasPreCorrectMedia
                ? <button className="btn" disabled={busy} onClick={showPreCorrectMedia}>正解発表前メディアを表示</button>
                : <button className="btn" disabled={busy} onClick={showCorrectAnswer}>正解発表</button>
            )}
            {phase === "PRE_CORRECT_MEDIA" && <button className="btn" disabled={busy} onClick={showCorrectAnswer}>正解発表</button>}
            {phase === "CORRECT_ANSWER_SHOWN" && (
              hasMoreQuestions ? <button className="btn" disabled={busy} onClick={nextQuestion}>次の問題へ</button> :
                <button className="btn" disabled={busy} onClick={showRanking}>ランキング表示</button>
            )}
            {phase === "RANKING" && rankingRevealRank !== 0 && (
              <button className="btn" disabled={busy} onClick={showNextRankingReveal}>
                {getRankingRevealActionLabel(rankingRevealRank)}
              </button>
            )}
          </div>

          {phase === "RANKING" && rankingRevealRank !== 0 && (
            <p className="admin-waiting-message">
              {getRankingRevealStatus(rankingRevealRank)}
            </p>
          )}

          {phase === "QUESTION_TRANSITION" && (
            <div className="admin-sub-actions">
              <span>補助操作</span>
              <button className="btn secondary" disabled={busy} onClick={showQuestion}>問題を表示</button>
            </div>
          )}

          <details className="admin-other-actions">
            <summary>その他の操作</summary>
            <div className="admin-other-actions-list">
              {phase !== "NOT_STARTED" && phase !== "CORRECT_ANSWER_SHOWN" && (
                <button className="btn secondary" disabled={busy} onClick={nextQuestion}>次の問題へ</button>
              )}
              {((phase !== "QUESTION_TRANSITION" && phase !== "PRE_QUESTION_MEDIA") ||
                (phase === "QUESTION_TRANSITION" && hasPreQuestionMedia)) && (
                <button className="btn secondary" disabled={busy} onClick={showQuestionAndStartAnswer}>問題を表示＋回答開始</button>
              )}
              {phase !== "QUESTION_SHOWN" && (
                <button className="btn secondary" disabled={busy} onClick={startAnswer}>回答開始</button>
              )}
              <button className="btn secondary" disabled={busy} onClick={nextAndStartAnswer}>次の問題へ+回答開始</button>
              {phase !== "ANSWER_CLOSED" && (
                <button className="btn secondary" disabled={busy} onClick={showAnswerCount}>回答結果を表示</button>
              )}
              {((phase !== "ANSWER_COUNT_SHOWN" && phase !== "PRE_CORRECT_MEDIA") ||
                (phase === "ANSWER_COUNT_SHOWN" && hasPreCorrectMedia)) && (
                <button className="btn secondary" disabled={busy} onClick={showCorrectAnswer}>正解発表</button>
              )}
              {(phase !== "CORRECT_ANSWER_SHOWN" || hasMoreQuestions) && (
                <button className="btn secondary" disabled={busy} onClick={showRanking}>ランキング表示</button>
              )}
            </div>
          </details>

          <div className="admin-question-previews">
            <QuestionPreview title="現在の問題" question={currentQuestionDetails} emptyMessage="まだ問題は開始されていません" />
            <QuestionPreview title="次の問題" question={nextQuestionDetails} />
          </div>

          {state?.phase === "RANKING" && state.ranking && (
            <table style={{ marginTop: 16 }}>
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
                    <td>{r.correct_count}</td>
                    <td>{(r.total_response_time_ms / 1000).toFixed(3)}秒</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="card" style={{ background: "#f9fafb", marginTop: 16 }}>
            <strong>現在のランキング(上位5位)</strong>
            {state?.top_ranking && state.top_ranking.length > 0 ? (
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>名前</th>
                    <th>正答数</th>
                    <th>合計回答時間</th>
                  </tr>
                </thead>
                <tbody>
                  {state.top_ranking.map((r) => (
                    <tr key={r.participant_id}>
                      <td>{r.rank}</td>
                      <td>{r.name}</td>
                      <td>{r.correct_count}</td>
                      <td>{(r.total_response_time_ms / 1000).toFixed(3)}秒</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ marginTop: 8, color: "#6b7280" }}>まだ参加者の回答がありません。</p>
            )}
          </div>
        </div>
      )}

      {tab === "qr" && (
        <div className="card">
          <h2>参加用QRコード</h2>
          <p>参加者はこのQRコードをスマートフォンで読み取って参加します。</p>
          <div className="qr-box">
            <QRCodeSVG value={joinUrl} size={220} />
          </div>
          <p>
            参加用URL: <a href={joinUrl}>{joinUrl}</a>
          </p>
          <p>
            会場モニター用URL: <a href={monitorUrl} target="_blank" rel="noreferrer">{monitorUrl}</a>
          </p>
        </div>
      )}
    </div>
  );
}
