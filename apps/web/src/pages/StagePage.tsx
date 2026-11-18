import { useEffect, useState, type ReactNode } from "react";
import { fontStack } from "../fonts";
import type { SlideStyle } from "../slide-types";

interface StageState {
  sessionId: string;
  status: string;
  blanked: boolean;
  mode: string;
  alert: string | null;
  slide: {
    index: number;
    total: number;
    title: string;
    lines: string[];
    kind: string;
    style: SlideStyle;
    next: { title: string; lines: string[] } | null;
  } | null;
}

/**
 * Stage/confidence view — large current-slide text for musicians plus the
 * next slide, clock, and session status (OpenSong stage mode, basic form).
 */
export function StagePage(): ReactNode {
  const params = new URLSearchParams(window.location.search);
  const [sessionId, setSessionId] = useState(params.get("session"));
  const [token, setToken] = useState(params.get("token") ?? localStorage.getItem("ps.token"));
  const [state, setState] = useState<StageState | null>(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    if (sessionId && token) return;
    const tryJoin = async () => {
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

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = async () => {
    if (!sessionId || !token) return;
    const res = await fetch(`/api/v1/sessions/${sessionId}/slide`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) setState((await res.json()) as StageState);
  };

  useEffect(() => {
    void refresh();
    if (!sessionId || !token) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", sessionId }));
    ws.onmessage = () => void refresh();
    ws.onclose = () => setTimeout(() => window.location.reload(), 3000);
    return () => ws.close();
  }, [sessionId, token]);

  if (!sessionId || !token || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black font-mono text-zinc-500">
        Waiting for a live session…
      </div>
    );
  }
  const s = state.slide;
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 font-mono text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <span className="text-lg">{s?.title ?? "—"}</span>
        <span className="text-2xl tabular-nums text-zinc-300">
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </header>
      {(state.blanked || state.mode !== "normal") && (
        <div className="bg-red-900/80 px-6 py-1 text-center text-sm font-bold uppercase tracking-widest">
          output {state.mode === "normal" ? "blanked" : state.mode}
        </div>
      )}
      {state.alert && (
        <div className="bg-amber-600 px-6 py-1 text-center text-sm font-bold text-black">{state.alert}</div>
      )}
      <main className="grid flex-1 grid-cols-[1fr_320px] gap-6 p-6">
        <div className="flex flex-col justify-center">
          {s ? (
            s.lines.map((l, i) => (
              <p
                key={i}
                className="text-4xl leading-snug"
                style={{ fontFamily: fontStack(s.style.body.font) }}
              >
                {l}
              </p>
            ))
          ) : (
            <p className="text-zinc-600">No slide</p>
          )}
        </div>
        <aside className="flex flex-col gap-4 border-l border-zinc-800 pl-6">
          <div>
            <div className="mb-1 text-xs uppercase tracking-widest text-zinc-500">Next</div>
            {s?.next ? (
              <>
                <div className="mb-1 text-sm text-zinc-400">{s.next.title}</div>
                {s.next.lines.map((l, i) => (
                  <p key={i} className="text-sm text-zinc-500">
                    {l}
                  </p>
                ))}
              </>
            ) : (
              <p className="text-sm text-zinc-600">End of service</p>
            )}
          </div>
          <div className="mt-auto text-xs text-zinc-600">
            {s ? `${s.index + 1} / ${s.total}` : ""}
          </div>
        </aside>
      </main>
    </div>
  );
}
