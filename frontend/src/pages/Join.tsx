import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { getParticipantSession, setParticipantSession } from "../participantSession";
import { EventSummary } from "../types";

interface JoinResponseLikeLocal {
  participant_id: string;
  token: string;
  name: string;
  event_id: string;
}

export default function Join() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    // 既にこの端末でこの大会に参加済みの場合はそのまま回答画面へ
    const existing = getParticipantSession(eventId);
    if (existing) {
      navigate(`/play/${eventId}`, { replace: true });
      return;
    }
    api
      .get<EventSummary>(`/api/events/${eventId}`)
      .then(setEvent)
      .catch((err) => setError(err.message));
  }, [eventId, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<JoinResponseLikeLocal>(`/api/events/${eventId}/join`, { name });
      setParticipantSession(res);
      navigate(`/play/${eventId}`);
    } catch (err: any) {
      setError(err.message || "参加に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>{event ? event.name : "クイズ大会"}に参加</h1>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>お名前</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} required />
          </div>
          <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            参加する
          </button>
        </form>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12 }}>
          ※ 同じ名前でも参加者ごとに別のIDで管理されます。
        </p>
      </div>
    </div>
  );
}
