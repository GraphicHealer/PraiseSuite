import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationSession } from "@praisesuite/core";
import { SlideCanvas } from "../components/SlideCanvas.js";
import { api, type PresentMode } from "../api.js";
import type { SlideStyle } from "../slide-types";

type OutputPlanSlide = { index: number; itemId: string; sectionLabel: string | null; prefix: string | null; blank: boolean };
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
  subtitle: string | null;
  emphasize: boolean;
  /** OpenSong slide_group @seconds/@loop — auto-advance + group wrap. */
  seconds: number;
  loop: boolean;
  /** OpenSong slide_group @transition — 0=default, 1=force, 2=off. */
  transition: number;
  /** OpenSong image-group @resize/@keep_aspect. */
  imageResize?: string | null;
  imageKeepAspect?: boolean;
  verseMap: { prev: string[]; curr: string; rest: string[] } | null;
  /** OpenSong style/@mouse_cursor (arrow|cross|hidden|hourglass|ibeam). */
  mouseCursor?: string;
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
  const startServiceId = params.get("service");
  const startItemId = params.get("item");
  /** ?present=1: this window IS the presentation — Esc ends it and
   *  restores the control window (single-screen OpenSong mode). */
  const presenting = params.get("present") === "1";
  const [sessionId, setSessionId] = useState(params.get("session"));
  const [token, setToken] = useState(params.get("token") ?? localStorage.getItem("ps.token"));
  const [state, setState] = useState<SlideState | null>(null);
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [frozen, setFrozen] = useState<SlideState | null>(null);
  /** True when this window owns output control (single screen or Electron
   *  output window) — network receivers never drive auto-advance. */
  const [drives, setDrives] = useState(presenting);
  const wsRef = useRef<WebSocket | null>(null);

  // ?service=<id> (single-screen present): this window starts the session —
  // OpenSong's single-monitor mode runs the output window alone.
  const startRef = useRef(false);
  useEffect(() => {
    if (!startServiceId || sessionId || startRef.current) return;
    startRef.current = true;
    void (async () => {
      const svc = await api.service(startServiceId);
      // OpenSong style/@initial_mode — the mode a presentation opens in.
      const initialMode = await api.style()
        .then((s) => ({ N: "normal", B: "blank", W: "white", H: "hidden", L: "logo", F: "freeze" } as const)[s.initialMode?.[0]?.toUpperCase() as "N" | "B" | "W" | "H" | "L" | "F"] ?? "normal")
        .catch(() => "normal" as PresentMode);
      const id = crypto.randomUUID() as PresentationSession["id"];
      const session: PresentationSession = {
        id,
        serviceId: svc.id,
        name: svc.name,
        status: "live",
        position: {
          sessionId: id,
          serviceItemId: null,
          songId: null,
          arrangementId: null,
          sectionId: null,
          sectionInstanceId: null,
          positionWithinSection: 0,
        },
        blanked: false,
        mode: initialMode,
        alert: null,
        controlOwner: null,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      };
      await api.saveSession(session);
      if (startItemId) await api.navigate(id, "item", undefined, startItemId).catch(() => {});
      else await api.navigate(id, "first").catch(() => {});
      const { token: t } = await api.guestToken(id, ["view"]);
      setToken(t);
      setSessionId(id);
    })().catch(() => {});
  }, [startServiceId, sessionId, startItemId]);

  // No params: auto-join the most recent live session (display windows / QR joins).
  useEffect(() => {
    if (sessionId && token) return;
    if (startServiceId && !sessionId) return; // session create is in flight
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
    } else if (res.status === 404 || res.status === 403) {
      // Session is gone (ended/deleted) — drop the dead subscription and
      // fall back to auto-join instead of showing a frozen slide forever.
      setState(null);
      setSessionId(null);
      setToken(null);
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
      if (msg.type === "session_ended" && presenting) {
        const p = (window as { ps?: { presentExit?: () => Promise<void> } }).ps;
        void p?.presentExit?.();
      }
    };
    return () => ws.close();
  }, [sessionId, token]);

  // Track the pre-freeze frame so freeze can hold it.
  useEffect(() => {
    if (state && state.mode !== "freeze") setFrozen(state);
  }, [state]);

  // Single-screen mode: this window IS the output (Electron), so the
  // OpenSong keymap drives the session directly — no helper needed.
  const planRef = useRef<OutputPlan | null>(null);
  const stateRef = useRef<SlideState | null>(null);
  const [escArmed, setEscArmed] = useState(false);
  const escArmedRef = useRef(false);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);

  // OpenSong timerAdvance (slide_group @seconds): one interval per slide —
  // past the last slide of the group, @loop wraps to its first; else next.
  // Only the output window that owns control advances (single/test/dual
  // outputs and ?present windows); network receivers never do.
  useEffect(() => {
    const slide = state?.slide;
    if (!drives || !slide || slide.seconds <= 0 || !sessionId || !stateRef.current) return;
    const t = setTimeout(() => {
      const s = stateRef.current;
      const plan = planRef.current;
      const cur = slide.index;
      const inItem = (plan?.slides ?? []).filter(
        (x) => x.itemId === plan?.slides.find((y) => y.index === cur)?.itemId && !x.blank,
      );
      const last = inItem[inItem.length - 1];
      if (slide.loop && last && cur >= last.index && inItem[0]) {
        void api.navigate(s!.sessionId, "jump", inItem[0].index).catch(() => {});
      } else {
        void api.navigate(s!.sessionId, "next").catch(() => {});
      }
    }, slide.seconds * 1000);
    return () => clearTimeout(t);
  }, [drives, state?.slide?.index, state?.slide?.seconds, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const ps = (window as { ps?: { isOutput?: () => Promise<boolean>; toggleOutput?: () => Promise<string>; presentExit?: () => Promise<void> } }).ps;
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
      // Left arrow lands ON the separator blank; Backspace on first content.
      const prevSection = (includeBlank: boolean) => {
        if (!plan) return api.navigate(s.sessionId, "prev").catch(() => {});
        const curItem = plan.slides.find((x) => x.index === cur)?.itemId;
        const items = [...new Set(plan.slides.map((x) => x.itemId))];
        const i = items.indexOf(curItem ?? "");
        const match = (x: OutputPlanSlide) => x.itemId === curItem && (includeBlank || !x.blank);
        const first = plan.slides.find(match);
        const prev = i > 0
          ? plan.slides.find((x) => x.itemId === items[i - 1] && (includeBlank || !x.blank))
          : undefined;
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
      else if (key === "ArrowLeft") prevSection(true);
      else if (key === "Backspace") prevSection(false);
      else if (key === "Escape") {
        if (escArmedRef.current) {
          // End the session, then restore the control window (single mode).
          void api.endSession(s.sessionId).catch(() => {});
          if (presenting) void ps?.presentExit?.();
        } else armEsc();
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
          case "v": jumpSection((x) => x.sectionLabel?.toLowerCase().startsWith("v") ?? false); break;
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
    const install = () => {
      if (installed) return;
      installed = true;
      setDrives(true);
      void api.sessionPlan(sessionId).then((p) => { planRef.current = p as OutputPlan; }).catch(() => {});
      window.addEventListener("keydown", onKey);
    };
    if (presenting) install(); else void ps?.isOutput?.().then((yes) => { if (yes) install(); });
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

  return (
    <div
      className="fixed inset-0 bg-black"
      style={{
        cursor: (
          { arrow: "default", cross: "crosshair", hourglass: "wait", ibeam: "text" } as Record<string, string>
        )[slide?.mouseCursor ?? "hidden"] ?? "none",
      }}
    >
      <SlideCanvas
        title={slide?.title ?? ""}
        lines={slide?.lines ?? []}
        style={slide?.style}
        backgroundKey={slide?.backgroundKey}
        backgroundAsText={slide?.backgroundAsText}
        mediaKey={slide?.mediaKey}
        logoKey={slide?.logoKey}
        mode={state?.mode ?? "normal"}
        blanked={state?.blanked ?? false}
        alert={state?.alert}
        index={slide?.index}
        total={slide?.total}
        subtitle={slide?.subtitle}
        emphasize={slide?.emphasize}
        verseMap={slide?.verseMap}
        transition={slide?.transition}
        imageResize={slide?.imageResize ?? ""}
        imageKeepAspect={slide?.imageKeepAspect ?? true}
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
