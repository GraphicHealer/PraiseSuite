import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlideCanvas } from "../components/SlideCanvas.js";
import { api, type PresentMode } from "../api.js";
import type { SlideStyle } from "../slide-types";

type OutputPlanSlide = { index: number; itemId: string; sectionLabel: string | null; prefix: string | null };
type OutputPlan = { slides: OutputPlanSlide[]; current: number };

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
      if (["position", "blank", "control", "mode", "alert", "session_ended"].includes(msg.type)) void refresh();
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

  // Single-screen mode: this window IS the output (Electron), so the
  // OpenSong keymap drives the session directly — no helper needed.
  const planRef = useRef<OutputPlan | null>(null);
  const stateRef = useRef<SlideState | null>(null);
  const [escArmed, setEscArmed] = useState(false);
  const escArmedRef = useRef(false);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    if (!sessionId) return;
    const ps = (window as { ps?: { isOutput?: () => Promise<boolean>; toggleOutput?: () => Promise<string> } }).ps;
    let installed = false;
    const armEsc = () => {
      escArmedRef.current = true;
      setEscArmed(true);
      if (escTimer.current) clearTimeout(escTimer.current);
      escTimer.current = setTimeout(() => { escArmedRef.current = false; setEscArmed(false); }, 3000);
    };
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s) return;
      const plan = planRef.current;
      const cur = s.slide?.index ?? 0;
      const jump = (idx: number) => void api.navigate(s.sessionId, "jump", idx).catch(() => {});
      const jumpItem = (delta: number) => {
        if (!plan) return;
        const items = [...new Set(plan.slides.map((x) => x.itemId))];
        const i = items.indexOf(plan.slides.find((x) => x.index === cur)?.itemId ?? "");
        const t = items[Math.max(0, Math.min(items.length - 1, i + delta))];
        const slide = plan.slides.find((x) => x.itemId === t);
        if (slide) jump(slide.index);
      };
      const jumpSection = (match: (x: OutputPlanSlide) => boolean) => {
        const after = plan?.slides.find((x) => x.index > cur && match(x));
        const target = after ?? plan?.slides.find(match);
        if (target) jump(target.index);
      };
      const prevSection = () => {
        if (!plan) return api.navigate(s.sessionId, "prev").catch(() => {});
        const curItem = plan.slides.find((x) => x.index === cur)?.itemId;
        const items = [...new Set(plan.slides.map((x) => x.itemId))];
        const i = items.indexOf(curItem ?? "");
        const first = plan.slides.find((x) => x.itemId === curItem);
        const prev = i > 0 ? plan.slides.find((x) => x.itemId === items[i - 1]) : undefined;
        const target = first && first.index < cur ? first : prev ?? first;
        if (target) jump(target.index);
      };
      const toggle = (m: PresentMode) => void api.setMode(s.sessionId, s.mode === m ? "normal" : m).catch(() => {});
      let handled = true;
      const key = e.key;
      if (key === " " || key === "ArrowDown" || key === "PageDown") void api.navigate(s.sessionId, "next").catch(() => {});
      else if (key === "ArrowUp" || key === "PageUp") void api.navigate(s.sessionId, "prev").catch(() => {});
      else if (key === "Home") { const f = plan?.slides[0]; if (f) jump(f.index); else handled = false; }
      else if (key === "End") { const l = plan?.slides[plan.slides.length - 1]; if (l) jump(l.index); else handled = false; }
      else if (key === "ArrowRight") jumpItem(1);
      else if (key === "ArrowLeft" || key === "Backspace") prevSection();
      else if (key === "Escape") {
        if (escArmedRef.current) void api.endSession(s.sessionId).catch(() => {});
        else armEsc();
      } else if (/^F(\d|1[0-5])$/.test(key)) {
        const items = [...new Set((plan?.slides ?? []).map((x) => x.itemId))];
        const slide = plan?.slides.find((x) => x.itemId === items[parseInt(key.slice(1), 10) - 1]);
        if (slide) jump(slide.index);
      } else if (/^[1-9]$/.test(key)) {
        jumpSection((x) => x.prefix === key || x.sectionLabel?.toLowerCase() === `v${key}`);
      } else {
        switch (key.toLowerCase()) {
          case "n": void api.setMode(s.sessionId, "normal").catch(() => {}); break;
          case "k": toggle("blank"); break;
          case "w": toggle("white"); break;
          case "h": toggle("hidden"); break;
          case "l": toggle("logo"); break;
          case "f": toggle("freeze"); break;
          case "m": void ps?.toggleOutput?.(); break;
          case "`":
          case "c": jumpSection((x) => x.sectionLabel?.toLowerCase().startsWith("c") ?? false); break;
          case "p": jumpSection((x) => x.sectionLabel?.toLowerCase().startsWith("p") ?? false); break;
          case "b": jumpSection((x) => x.sectionLabel?.toLowerCase().startsWith("b") ?? false); break;
          case "t": jumpSection((x) => x.sectionLabel?.toLowerCase().startsWith("t") ?? false); break;
          default: handled = false;
        }
      }
      if (handled) e.preventDefault();
    };
    void ps?.isOutput?.().then((yes) => {
      if (!yes) return;
      installed = true;
      void api.sessionPlan(sessionId).then((p) => { planRef.current = p as OutputPlan; }).catch(() => {});
      window.addEventListener("keydown", onKey);
    });
    return () => { if (installed) window.removeEventListener("keydown", onKey); };
  }, [sessionId]);

  if (!sessionId || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-600">
        {waiting ? "Waiting for a live session…" : "Joining…"}
      </div>
    );
  }
  if (state?.status === "ended") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-600">
        Presentation ended
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
      {escArmed && (
        <div className="fixed inset-x-0 bottom-8 flex justify-center">
          <span className="rounded bg-zinc-900/90 px-4 py-2 text-sm text-zinc-200">
            Exit Presenter? Press Esc again to end.
          </span>
        </div>
      )}
    </div>
  );
}
