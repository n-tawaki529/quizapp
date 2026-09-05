import { useEffect, useRef, useState, useCallback } from "react";
import { WS_BASE } from "./api";

type Role = "monitor" | "participant" | "admin";

interface Options {
  token?: string | null;
  participantId?: string | null;
}

/**
 * 大会のWebSocketに接続し、サーバーからの状態通知を受け取るフック。
 * 切断時は自動的に再接続を試みる(指数バックオフ、上限10秒)。
 * 再接続に成功すると、サーバーは接続直後に現在の状態を送信するため、
 * 画面は自動的に最新の状態へ復元される。
 */
export function useEventSocket<T = any>(
  eventId: string | undefined,
  role: Role,
  opts: Options = {}
) {
  const [state, setState] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUserRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { token, participantId } = opts;

  const connect = useCallback(() => {
    if (!eventId) return;
    const params = new URLSearchParams({ role });
    if (token) params.set("token", token);
    if (participantId) params.set("participant_id", participantId);
    const url = `${WS_BASE}/ws/events/${eventId}?${params.toString()}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      attemptRef.current = 0;
    };
    ws.onmessage = (ev) => {
      try {
        setState(JSON.parse(ev.data));
      } catch {
        /* ignore malformed message */
      }
    };
    ws.onclose = () => {
      setConnected(false);
      if (closedByUserRef.current) return;
      const delay = Math.min(1000 * 2 ** attemptRef.current, 10000);
      attemptRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };
    ws.onerror = () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, role, token, participantId]);

  useEffect(() => {
    closedByUserRef.current = false;
    connect();
    return () => {
      closedByUserRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { state, connected };
}
