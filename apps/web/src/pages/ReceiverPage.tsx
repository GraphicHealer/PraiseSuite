import { useEffect, useRef, useState, type ReactNode } from "react";

interface SlideState {
  sessionId: string;
  status: string;
  blanked: boolean;
  slide: { index: number; total: number; title: string; lines: string[]; kind: string } | null;
}

/**
 * Presentation output page — loaded by the Electron display window and by
 * browsers joining as receivers. Connects with a session-scoped guest token
 * (TAS 13.3), subscribes over WS, and renders the current slide.
 */
export function ReceiverPage(): ReactNode {
  const params = new URLSearchParams(window.location.search);
  const [sessionId, setSessionId] = useState(params.get("session"));
  const [token, setToken] = useState(params.get("token") ?? localStorage.getItem("ps.token"));
  const [state, setState] = useState<SlideState | null>(null);
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // No params: auto-join the most recent live session (display windows / QR joins).
  useEffect(() => {
    if (sessionId && token) return;
    const tryJoin = async () => {
      setWaiting(true);
      const res = await fetch("/api/v1/receiver/join");
      if (res.ok) {
        const j = (await res.json()) as { sessionId: string; token: string };
        setSessionId(j.sessionId);
        setToken(j.token);
      } else {
        setTimeout(() => void tryJoin(), 3000);
      }
    };
    void tryJoin();
  }, [sessionId, token]);

  const refresh = async () => {
    if (!sessionId || !token) return;
    const res = await fetch(`/api/v1/sessions/${sessionId}/slide`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) setState((await res.json()) as SlideState);
  };

  useEffect(() => {
    void refresh();
    if (!sessionId || !token) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "subscribe", sessionId }));
    };
    ws.onclose = () => {
      setConnected(false);
      // Simple reconnect loop — Wi-Fi drops are expected (TAS 6.5).
      setTimeout(() => window.location.reload(), 3000);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as { type: string };
      if (msg.type === "position" || msg.type === "blank" || msg.type === "control") void refresh();
    };
    return () => ws.close();
  }, [sessionId, token]);

  if (!sessionId || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-600">
        {waiting ? "Waiting for a live session…" : "Joining…"}
      </div>
    );
  }
  if (!state || state.blanked || !state.slide) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <span className="text-xs text-zinc-700">{connected ? "" : "connecting…"}</span>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black p-8 text-white">
      <div className="max-w-5xl space-y-3 text-center">
        {state.slide.lines.map((l, i) => (
          <p key={i} className="text-5xl font-semibold leading-snug tracking-wide drop-shadow-md">
            {l}
          </p>
        ))}
      </div>
      <div className="fixed bottom-2 right-3 text-xs text-zinc-700">
        {state.slide.index + 1}/{state.slide.total}
      </div>
    </div>
  );
}
