import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlideCanvas } from "../components/SlideCanvas.js";
import type { SlideStyle } from "../slide-types";

interface SlidePayload {
  index: number;
  total: number;
  title: string;
  lines: string[];
  kind: string;
  mediaKey: string | null;
  style: SlideStyle;
  backgroundKey: string | null;
  /** OpenSong @background_as_text: image replaces the slide text. */
  backgroundAsText?: boolean;
  logoKey: string | null;
  loopSeconds: number | null;
  next: { title: string; lines: string[] } | null;
}

interface SlideState {
  sessionId: string;
  status: string;
  blanked: boolean;
  mode: "normal" | "blank" | "white" | "hidden" | "logo" | "freeze";
  alert: string | null;
  slide: SlidePayload | null;
}

/**
 * Presentation output page — Electron display windows and browser receivers.
 * Renders the resolved slide style (M6): backgrounds, logo/blank/freeze
 * modes, alert overlay, fade transitions, announcement loops.
 */
export function ReceiverPage(): ReactNode {
  const params = new URLSearchParams(window.location.search);
  const [sessionId, setSessionId] = useState(params.get("session"));
  const [token, setToken] = useState(params.get("token") ?? localStorage.getItem("ps.token"));
  const [state, setState] = useState<SlideState | null>(null);
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [frozen, setFrozen] = useState<SlideState | null>(null);
  const [loopIdx, setLoopIdx] = useState(0);
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
    if (res.ok) {
      const s = (await res.json()) as SlideState;
      setState((prev) => {
        // Freeze mode holds the last frame until released.
        if (s.mode === "freeze") return prev ?? s;
        return s;
      });
    }
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
      setTimeout(() => window.location.reload(), 3000);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as { type: string };
      if (["position", "blank", "control", "mode", "alert"].includes(msg.type)) void refresh();
    };
    return () => ws.close();
  }, [sessionId, token]);

  // Track the pre-freeze frame so freeze can hold it.
  useEffect(() => {
    if (state && state.mode !== "freeze") setFrozen(state);
  }, [state]);

  // Announcement loop: rotate through slices while positioned on a looping item.
  useEffect(() => {
    const loop = state?.slide?.loopSeconds;
    if (!loop || loop <= 0) {
      setLoopIdx(0);
      return;
    }
    const t = setInterval(() => setLoopIdx((i) => i + 1), loop * 1000);
    return () => clearInterval(t);
  }, [state?.slide?.loopSeconds, state?.slide?.index]);

  if (!sessionId || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-600">
        {waiting ? "Waiting for a live session…" : "Joining…"}
      </div>
    );
  }
  const shown = state?.mode === "freeze" ? frozen ?? state : state;
  const slide = shown?.slide ?? null;
  const lines = slide?.lines ?? [];
  // Looping announcements cycle their lines within the current slide.
  const visible = slide?.loopSeconds ? [lines[loopIdx % Math.max(1, lines.length)] ?? ""] : lines;

  return (
    <div className="fixed inset-0 bg-black">
      <SlideCanvas
        title={slide?.title ?? ""}
        lines={visible}
        style={slide?.style}
        backgroundKey={slide?.backgroundKey}
        backgroundAsText={slide?.backgroundAsText}
        mediaKey={slide?.mediaKey}
        logoKey={slide?.logoKey}
        mode={state?.mode ?? "normal"}
        blanked={state?.blanked ?? false}
        next={slide?.next}
        alert={state?.alert}
        index={slide?.index}
        total={slide?.total}
      />
      {!connected && (
        <span className="fixed bottom-2 right-3 text-xs text-zinc-700">connecting…</span>
      )}
    </div>
  );
}
