import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationSession, Service } from "@praisesuite/core";
import { api, type SlideResponse } from "../api.js";

const btn =
  "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";

/** Remote control surface: pick a session, take control, drive the outputs. */
export function PresentPage(): ReactNode {
  const [sessions, setSessions] = useState<PresentationSession[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [slide, setSlide] = useState<SlideResponse | null>(null);
  const [controlling, setControlling] = useState(false);
  const [receiverUrl, setReceiverUrl] = useState("");
  const [alertText, setAlertText] = useState("");
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    api.sessions().then(setSessions).catch((e) => setError((e as Error).message));
    api.services().then(setServices).catch(() => {});
  }, []);

  const refreshSlide = async (id: string) => {
    try {
      setSlide(await api.sessionSlide(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const attach = (s: PresentationSession) => {
    setSession(s);
    setControlling(false);
    void refreshSlide(s.id);
    wsRef.current?.close();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const token = localStorage.getItem("ps.token");
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", sessionId: s.id }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as { type: string; controlOwner?: string | null };
      if (["position", "blank", "mode", "alert"].includes(msg.type)) void refreshSlide(s.id);
      if (msg.type === "control") setControlling(false);
    };
    wsRef.current = ws;
  };

  const createSession = async () => {
    const svc = services.find((s) => s.id === (document.getElementById("svc-pick") as HTMLSelectElement).value);
    if (!svc) return;
    const id = crypto.randomUUID();
    const session: PresentationSession = {
      id: id as PresentationSession["id"],
      serviceId: svc.id,
      name: svc.name,
      status: "live",
      position: {
        sessionId: id as PresentationSession["id"],
        serviceItemId: null,
        songId: null,
        arrangementId: null,
        sectionId: null,
        sectionInstanceId: null,
        positionWithinSection: 0,
      },
      blanked: false,
      mode: "normal",
      alert: null,
      controlOwner: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    await api.saveSession(session);
    const list = await api.sessions();
    setSessions(list);
    attach(session);
    // First slide.
    await api.navigate(session.id, "first").catch(() => {});
    void refreshSlide(session.id);
  };

  const takeControl = async () => {
    if (!session) return;
    try {
      await api.control(session.id, true);
      setControlling(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const makeReceiverUrl = async () => {
    if (!session) return;
    const { token } = await api.guestToken(session.id, ["view"]);
    setReceiverUrl(`${window.location.origin}/receiver?session=${session.id}&token=${token}`);
  };

  const doNavigate = async (action: "next" | "prev" | "first" | "last") => {
    if (!session) return;
    try {
      await api.navigate(session.id, action);
      await refreshSlide(session.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-3 text-lg font-semibold">Present</h1>
      {!session ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select id="svc-pick" className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <option value="">Pick a service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button onClick={() => void createSession()} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500">
              Start session
            </button>
          </div>
          {sessions.length > 0 && (
            <div>
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Active sessions</h2>
              <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => attach(s)} className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-zinc-500">{s.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button onClick={() => { wsRef.current?.close(); setSession(null); }} className={btn}>← Sessions</button>
            <span className="font-medium">{session.name}</span>
            <span className="text-xs text-zinc-500">{slide?.status}</span>
            <div className="ml-auto flex gap-2">
              {!controlling ? (
                <button onClick={() => void takeControl()} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500">
                  Take control
                </button>
              ) : (
                <span className="rounded bg-emerald-100 px-3 py-1.5 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">In control</span>
              )}
              <button onClick={() => void makeReceiverUrl()} className={btn}>Receiver link</button>
            </div>
          </div>
          {receiverUrl && (
            <p className="mb-3 break-all rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900">{receiverUrl}</p>
          )}
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

          <div className="rounded-lg bg-black p-8 text-center text-white">
            {slide?.blanked ? (
              <p className="text-zinc-600">(blanked)</p>
            ) : slide?.slide ? (
              <div className="space-y-2">
                {slide.slide.lines.map((l, i) => (
                  <p key={i} className="text-2xl font-semibold">{l}</p>
                ))}
                <p className="pt-2 text-xs text-zinc-500">{slide.slide.title} — {slide.slide.index + 1}/{slide.slide.total}</p>
              </div>
            ) : (
              <p className="text-zinc-600">No slide</p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button disabled={!controlling} onClick={() => void doNavigate("first")} className={btn}>⇤ First</button>
            <button disabled={!controlling} onClick={() => void doNavigate("prev")} className={btn}>← Prev</button>
            <button
              disabled={!controlling}
              onClick={() => session && void api.blank(session.id, !(slide?.blanked ?? false)).then(() => refreshSlide(session.id))}
              className={btn}
            >
              {slide?.blanked ? "Unblank" : "Blank"}
            </button>
            <button disabled={!controlling} onClick={() => void doNavigate("next")} className="rounded bg-indigo-600 px-6 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">Next →</button>
            <button disabled={!controlling} onClick={() => void doNavigate("last")} className={btn}>Last ⇥</button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Mode:</span>
            {(["normal", "logo", "freeze"] as const).map((m) => (
              <button
                key={m}
                disabled={!controlling}
                onClick={() => session && void api.setMode(session.id, m).then(() => refreshSlide(session.id))}
                className={`${btn} ${slide?.mode === m ? "bg-indigo-100 dark:bg-indigo-950" : ""}`}
              >
                {m}
              </button>
            ))}
            <span className="ml-4 text-xs uppercase tracking-wide text-zinc-500">Alert:</span>
            <input
              value={alertText}
              onChange={(e) => setAlertText(e.target.value)}
              placeholder="Nursery alert, message…"
              className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
            />
            <button
              disabled={!controlling}
              onClick={() => session && void api.setAlert(session.id, alertText || null).then(() => refreshSlide(session.id))}
              className={btn}
            >
              Show
            </button>
            <button
              disabled={!controlling}
              onClick={() => {
                setAlertText("");
                if (session) void api.setAlert(session.id, null).then(() => refreshSlide(session.id));
              }}
              className={btn}
            >
              Clear
            </button>
            <a href="/stage" target="_blank" rel="noreferrer" className={`${btn} ml-4`}>Stage view</a>
          </div>
        </div>
      )}
    </div>
  );
}
