import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fontStack } from "../fonts";
import type { SlideStyle, TextStyle } from "../slide-types";

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
  mode: "normal" | "blank" | "logo" | "freeze";
  alert: string | null;
  slide: SlidePayload | null;
}

function mediaUrl(key: string): string {
  return `/api/v1/media/${encodeURIComponent(key.split("/").pop() ?? key)}`;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const isVideo = (key: string) => VIDEO_EXT.test(key);

function textCss(s: TextStyle): CSSProperties {
  return {
    fontFamily: fontStack(s.font),
    fontSize: `clamp(1rem, ${(s.size / 1080) * 1920}px, ${s.size * 4}px)`,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textDecoration: s.underline ? "underline" : "none",
    color: s.color,
    textAlign: s.align,
    textShadow: [
      s.border ? `-${s.borderThickness}px -${s.borderThickness}px 0 ${s.borderColor}, ${s.borderThickness}px -${s.borderThickness}px 0 ${s.borderColor}, -${s.borderThickness}px ${s.borderThickness}px 0 ${s.borderColor}, ${s.borderThickness}px ${s.borderThickness}px 0 ${s.borderColor}` : "",
      s.shadow ? `0 ${s.borderThickness * 2}px ${s.borderThickness * 3}px ${s.shadowColor}` : "",
    ]
      .filter(Boolean)
      .join(", ") || "none",
  };
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
  const style = slide?.style;
  const bg = slide?.backgroundKey ? mediaUrl(slide.backgroundKey) : null;
  const black = !state || state.blanked || state.mode === "blank" || !slide;
  const logoOnly = state?.mode === "logo" && slide?.logoKey;
  const lines = slide?.lines ?? [];
  // Looping announcements cycle their lines within the current slide.
  const visible = slide?.loopSeconds ? [lines[loopIdx % Math.max(1, lines.length)] ?? ""] : lines;

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden bg-black transition-opacity"
      style={{ transitionDuration: `${style?.transitionMs ?? 100}ms` }}
    >
      {!black && style && (
        <>
          {bg && isVideo(slide?.backgroundKey ?? "") ? (
            <video
              key={bg}
              src={bg}
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : bg ? (
            <img
              src={bg}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-opacity"
              style={{ transitionDuration: `${style.transitionMs}ms` }}
            />
          ) : null}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: bg ? "transparent" : style.backgroundColor }}
          />
        </>
      )}
      {slide?.mediaKey && !black && !logoOnly && (
        isVideo(slide.mediaKey) ? (
          <video
            key={slide.mediaKey}
            src={mediaUrl(slide.mediaKey)}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 z-[1] h-full w-full object-contain bg-black"
          />
        ) : (
          <img
            src={mediaUrl(slide.mediaKey)}
            alt=""
            className="absolute inset-0 z-[1] h-full w-full object-contain bg-black"
          />
        )
      )}
      {logoOnly && slide?.logoKey && (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <img src={mediaUrl(slide.logoKey)} alt="logo" className="max-h-[60vh] max-w-[60vw]" />
        </div>
      )}
      {!black && !logoOnly && style && !(slide?.backgroundAsText && bg) && (
        <div
          className="relative flex min-h-screen flex-1 flex-col justify-center"
          style={{
            padding: style.margin,
            justifyContent:
              style.body.valign === "top" ? "flex-start" : style.body.valign === "bottom" ? "flex-end" : "center",
            alignItems:
              style.body.align === "left" ? "flex-start" : style.body.align === "right" ? "flex-end" : "center",
            transition: style.transition ? `opacity ${style.transitionMs}ms` : "none",
          }}
        >
          {style.title.enabled && (
            <div className="absolute top-0 right-0 left-0 px-8 pt-4" style={textCss(style.title)}>
              {slide.title}
            </div>
          )}
          <div className="max-w-full space-y-4">
            {visible.map((l, i) => (
              <p key={`${slide.index}-${loopIdx}-${i}`} style={textCss(style.body)} className="leading-snug">
                {l}
              </p>
            ))}
          </div>
          {style.subtitle.enabled && (
            <div className="absolute right-0 bottom-0 left-0 px-8 pb-4" style={textCss(style.subtitle)}>
              {style.descriptiveSubtitles
                ? (slide.next ? `${slide.next.title}` : "")
                : slide.title.split(" — ")[0]}
            </div>
          )}
        </div>
      )}
      {state?.alert && (
        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-xl bg-amber-500/95 px-8 py-4 text-3xl font-bold text-black shadow-2xl">
          {state.alert}
        </div>
      )}
      {!connected && (
        <span className="fixed bottom-2 right-3 text-xs text-zinc-700">connecting…</span>
      )}
      {slide && !black && !logoOnly && (
        <div className="fixed bottom-2 right-3 text-xs text-zinc-600/60">
          {slide.index + 1}/{slide.total}
        </div>
      )}
    </div>
  );
}
