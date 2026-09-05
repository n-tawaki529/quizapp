import { useEffect, useRef, useState } from "react";

/**
 * サーバー基準の締切時刻(deadlineIso)までの残り時間をミリ秒単位で計算するフック。
 * クライアントの時計のずれを補正するため、状態メッセージに含まれる server_time
 * (サーバーがその状態を構築した時刻)との差分をオフセットとして利用する。
 *
 * 重要: この残り時間はUI表示専用であり、実際の受付終了判定は必ずサーバー側で行う。
 */
export function useCountdown(deadlineIso: string | null | undefined, serverTimeIso: string | null | undefined) {
  const offsetRef = useRef(0);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (serverTimeIso) {
      offsetRef.current = new Date(serverTimeIso).getTime() - Date.now();
    }
  }, [serverTimeIso]);

  useEffect(() => {
    if (!deadlineIso) {
      setRemainingMs(null);
      return;
    }
    const deadline = new Date(deadlineIso).getTime();
    const tick = () => {
      const now = Date.now() + offsetRef.current;
      setRemainingMs(Math.max(0, deadline - now));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadlineIso]);

  return remainingMs;
}
