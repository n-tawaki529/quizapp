import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setAdminToken } from "../api";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ token: string }>("/api/admin/login", { password });
      setAdminToken(res.token);
      navigate("/admin");
    } catch (err: any) {
      setError(err.message || "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>管理者ログイン</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="password">管理者パスワード</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          <button className="btn" type="submit" disabled={loading}>
            ログイン
          </button>
        </form>
      </div>
    </div>
  );
}
