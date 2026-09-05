export const API_BASE: string =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8000";

export const WS_BASE: string = API_BASE.replace(/^http/, "ws");

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail);
  }
  if (res.status === 204) return null as unknown as T;
  return (await res.json()) as T;
}

export function getAdminToken(): string | null {
  return localStorage.getItem("admin_token");
}

export function setAdminToken(token: string) {
  localStorage.setItem("admin_token", token);
}

export function clearAdminToken() {
  localStorage.removeItem("admin_token");
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const api = {
  get: <T,>(path: string) => request<T>(path, { method: "GET" }),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

export const participantApi = {
  post: <T,>(path: string, body: unknown, token: string) =>
    request<T>(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
};

export const adminApi = {
  get: <T,>(path: string) => request<T>(path, { method: "GET", headers: adminHeaders() }),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: adminHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: adminHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE", headers: adminHeaders() }),
  uploadMedia: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/api/admin/media/upload`, {
      method: "POST",
      headers: adminHeaders(),
      body: formData,
    });
    if (!res.ok) {
      throw new ApiError("メディアのアップロードに失敗しました");
    }
    return res.json();
  },
};

export function mediaUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}
