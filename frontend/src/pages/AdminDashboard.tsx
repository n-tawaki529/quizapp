import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminApi, clearAdminToken } from "../api";
import { EventAdminDetail } from "../types";

export default function AdminDashboard() {
  const [events, setEvents] = useState<EventAdminDetail[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try {
      const list = await adminApi.get<EventAdminDetail[]>("/api/admin/events");
      setEvents(list);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const created = await adminApi.post<{ id: string }>("/api/admin/events", { name });
      setName("");
      await load();
      navigate(`/admin/events/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearAdminToken();
    navigate("/admin/login");
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>大会管理</h1>
        <button className="btn secondary" onClick={handleLogout}>
          ログアウト
        </button>
      </div>

      <div className="card">
        <h2>新しい大会を作成</h2>
        <form onSubmit={handleCreate} className="row">
          <input
            style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #d1d5db" }}
            placeholder="大会名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn" type="submit" disabled={loading}>
            作成
          </button>
        </form>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>

      <div className="card">
        <h2>大会一覧</h2>
        <table>
          <thead>
            <tr>
              <th>大会名</th>
              <th>状態</th>
              <th>進行状況</th>
              <th>問題数</th>
              <th>参加者数</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>
                  <span className="badge">{e.status}</span>
                </td>
                <td>
                  {e.phase}
                  {e.current_question_number ? `(第${e.current_question_number}問)` : ""}
                </td>
                <td>{e.question_count}</td>
                <td>{e.participant_count}</td>
                <td>
                  <Link to={`/admin/events/${e.id}`}>管理する</Link>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={6}>大会がまだありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
