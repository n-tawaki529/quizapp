import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { adminApi, getAdminToken, mediaUrl } from "../api";
import { useEventSocket } from "../useEventSocket";
import { EventAdminDetail, MonitorState, QuestionAdminOut } from "../types";
import QuestionForm from "./QuestionForm";

const PHASE_LABEL: Record<string, string> = {
  NOT_STARTED: "未開始",
  QUESTION_SHOWN: "回答待機中",
  ANSWER_OPEN: "回答受付中",
  ANSWER_CLOSED: "回答受付終了",
  RANKING: "ランキング表示中",
};

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
    if (!window.confirm(`第${q.question_number}問を削除しますか?`)) return;
    await adminApi.delete(`/api/admin/events/${eventId}/questions/${q.id}`);
    await loadQuestions();
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!eventId) return;
    const newOrder = [...questions];
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
                {questions.map((q, idx) => (
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
                        disabled={idx === questions.length - 1}
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
              nextQuestionNumber={questions.length + 1}
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
          <p style={{ fontSize: 18, fontWeight: 700 }}>
            {state?.question ? `第${state.question.question_number}問` : "問題未表示"}・
            {PHASE_LABEL[state?.phase ?? ""] ?? "-"}
          </p>
          <p>
            参加者数: {state?.participant_count ?? "-"} (接続中 {state?.connected_participant_count ?? "-"}) / 回答数:{" "}
            {state?.answered_count ?? "-"}
          </p>
          {state?.question && (
            <div className="card" style={{ background: "#f9fafb" }}>
              <strong>{state.question.question_text}</strong>
              {state.question.question_media_url && state.question.question_media_type === "IMAGE" && (
                <div>
                  <img src={mediaUrl(state.question.question_media_url)} style={{ maxWidth: 300 }} />
                </div>
              )}
              <ul>
                {state.question.choices.map((c) => (
                  <li key={c.choice_key}>
                    {c.choice_key}: {c.content_type === "TEXT" ? c.text : `[${c.content_type}] ${c.media_url}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="row">
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                runAction(
                  () => adminApi.post(`/api/admin/events/${eventId}/next`),
                  "次の問題へ進みます。よろしいですか?"
                )
              }
            >
              次の問題へ
            </button>
            <button
              className="btn"
              disabled={busy || state?.phase !== "QUESTION_SHOWN"}
              onClick={() =>
                runAction(
                  () => adminApi.post(`/api/admin/events/${eventId}/start-answer`),
                  "回答受付を開始します。よろしいですか?"
                )
              }
            >
              回答開始
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                runAction(
                  () => adminApi.post(`/api/admin/events/${eventId}/show-ranking`),
                  "会場モニターをランキング表示に切り替えます。よろしいですか?"
                )
              }
            >
              ランキング表示
            </button>
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
