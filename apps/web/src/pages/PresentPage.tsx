import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationSession, Service, ServiceItem } from "@praisesuite/core";
import { AddItemDialog, type AddItemTab } from "../components/AddItemDialog.js";
import { useDialog } from "../components/Dialog.js";
import { SlideCanvas } from "../components/SlideCanvas.js";
import { api, type PresentMode, type SlideResponse } from "../api.js";

const btn =
  "rounded border border-zinc-300 px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";

type PlanSlide = {
  index: number;
  itemId: string;
  itemTitle: string;
  itemKind: string;
  slideInItem: number;
  firstLine: string;
  sectionLabel: string | null;
  prefix: string | null;
  slideId: string | null;
  sectionInstanceId: string | null;
  loopSeconds: number;
  itemNotes: string | null;
  blank: boolean;
};
type Plan = { slides: PlanSlide[]; current: number; total: number };

/**
 * OpenSong Presentation Helper — operator console matching
 * PresentHelperWindow.xojo_window: slide list over notes over dual previews,
 * Mode/Actions/keys column, and the full OpenSong key map.
 */
export function PresentPage({
  startService,
  startItemId,
  onExit,
}: {
  startService?: Service | null;
  startItemId?: string | null;
  /** Desktop single-user flow: End returns to wherever present was launched. */
  onExit?: () => void;
}): ReactNode {
  const dlg = useDialog();
  const [sessions, setSessions] = useState<PresentationSession[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [slide, setSlide] = useState<SlideResponse | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [controlling, setControlling] = useState(false);
  const [receiverUrl, setReceiverUrl] = useState("");
  const [alertText, setAlertText] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [addTab, setAddTab] = useState<AddItemTab | null>(null);
  const [frozen, setFrozen] = useState<SlideResponse | null>(null);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const curRowRef = useRef<HTMLTableRowElement | null>(null);
  const alertRef = useRef<HTMLInputElement | null>(null);

  const refreshSlide = useCallback(async (id: string) => {
    try {
      const s = await api.sessionSlide(id);
      if (s.mode !== "freeze") setFrozen(s);
      setSlide(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refreshPlan = useCallback(async (id: string) => {
    try {
      setPlan(await api.sessionPlan(id));
    } catch {
      /* pre-plan sessions */
    }
  }, []);

  const attach = useCallback(
    (s: PresentationSession) => {
      setSession(s);
      setControlling(false);
      void refreshSlide(s.id);
      void refreshPlan(s.id);
      wsRef.current?.close();
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const token = localStorage.getItem("ps.token");
      const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}`);
      ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", sessionId: s.id }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as { type: string };
        if (["position", "blank", "mode", "alert"].includes(msg.type)) {
          void refreshSlide(s.id);
          void refreshPlan(s.id);
        }
        if (msg.type === "control") setControlling(false);
      };
      wsRef.current = ws;
    },
    [refreshSlide, refreshPlan],
  );

  const startFor = useCallback(
    async (svc: Service, itemId?: string | null) => {
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
      setSessions(await api.sessions());
      attach(session);
      if (itemId) await api.navigate(session.id, "item", undefined, itemId).catch(() => {});
      else await api.navigate(session.id, "first").catch(() => {});
      void refreshSlide(session.id);
      void refreshPlan(session.id);
      void api.control(session.id, true).then(() => setControlling(true)).catch(() => {});
    },
    [attach, refreshSlide, refreshPlan],
  );

  const startRef = useRef(false);
  useEffect(() => {
    api.sessions()
      .then((list) => {
        setSessions(list);
        // Single-user desktop: re-attach to the live session instead of
        // showing a picker. A picker only appears when nothing is live.
        if (!startService && list.length > 0 && !startRef.current) {
          startRef.current = true;
          attach(list[0]!);
        }
      })
      .catch((e) => setError((e as Error).message));
    api.services().then(setServices).catch(() => {});
    if (startService && !startRef.current) {
      startRef.current = true;
      void startFor(startService, startItemId);
    }
  }, [startService, startFor, startItemId, attach]);

  // Keep the current slide row scrolled into view (OpenSong auto-selects it).
  useEffect(() => {
    curRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [plan?.current]);

  const doNavigate = useCallback(
    async (action: "next" | "prev" | "first" | "last" | "jump" | "item", index?: number, itemId?: string) => {
      if (!session) return;
      try {
        await api.navigate(session.id, action, index, itemId);
        await refreshSlide(session.id);
        await refreshPlan(session.id);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [session, refreshSlide, refreshPlan],
  );

  const setMode = useCallback(
    (m: PresentMode) => {
      if (!session) return;
      void api.setMode(session.id, m).then(() => refreshSlide(session.id));
    },
    [session, refreshSlide],
  );

  // OpenSong PresentHelperWindow key map.
  const jumpToItem = useCallback(
    (delta: number) => {
      if (!plan || !session) return;
      const ids = [...new Set(plan.slides.map((s) => s.itemId))];
      const curItem = plan.slides[plan.current]?.itemId;
      const i = ids.indexOf(curItem ?? "");
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + delta))];
      const target = plan.slides.find((s) => s.itemId === next);
      if (target) void doNavigate("jump", target.index);
    },
    [plan, session, doNavigate],
  );

  /** OpenSong GoPreviousSection (Left arrow AND Backspace): back to the
   * FIRST slide of the current item; if already there, the previous item.
   * Skips style/@blanks separators — backspace never lands on a blank. */
  const prevSection = useCallback(() => {
    if (!plan || !session) return;
    const curItem = plan.slides[plan.current]?.itemId;
    const firstOfItem = plan.slides.find((s) => s.itemId === curItem && !s.blank);
    if (firstOfItem && plan.current > firstOfItem.index) {
      void doNavigate("jump", firstOfItem.index);
      return;
    }
    const ids = [...new Set(plan.slides.map((s) => s.itemId))];
    const prev = ids[Math.max(0, ids.indexOf(curItem ?? "") - 1)];
    const target = plan.slides.find((s) => s.itemId === prev && !s.blank);
    if (target) void doNavigate("jump", target.index);
  }, [plan, session, doNavigate]);

  const jumpToSection = useCallback(
    (match: (s: PlanSlide) => boolean) => {
      if (!plan || !session) return;
      const curItem = plan.slides[plan.current]?.itemId;
      const inItem = plan.slides.filter((s) => s.itemId === curItem && match(s));
      const pool = inItem.length > 0 ? inItem : plan.slides.filter(match);
      const target = pool.find((s) => s.index > plan.current) ?? pool[0];
      if (target) void doNavigate("jump", target.index);
    },
    [plan, session, doNavigate],
  );

  /** OpenSong [Q]/[S] quick-insert opens the shared Add Item dialog. */
  const openAdd = useCallback((tab: AddItemTab) => setAddTab(tab), []);

  // [M] toggles the OUTPUT window (OpenSong Full Screen); falls back to
  // this window's fullscreen in plain browsers.
  const toggleFullscreen = useCallback(() => {
    const ps = (window as unknown as { ps?: { toggleOutput?: () => Promise<string> } }).ps;
    if (ps?.toggleOutput) {
      void ps.toggleOutput().then((s) => setFullscreen(s === "fullscreen"));
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setFullscreen(false);
    } else {
      void document.documentElement.requestFullscreen();
      setFullscreen(true);
    }
  }, []);

  const leave = useCallback(() => {
    wsRef.current?.close();
    setSession(null);
    setSlide(null);
    setPlan(null);
    onExit?.();
  }, [onExit]);

  /** OpenSong Esc/close: END the presentation, not just detach. */
  const endSession = useCallback(
    async (id?: string) => {
      const sid = id ?? session?.id;
      if (sid) await api.endSession(sid).catch(() => {});
      setSessions(await api.sessions().catch(() => sessions));
      if (!id || sid === session?.id) leave();
    },
    [session, sessions, leave],
  );

  /** OpenSong chk_style_exit_prompt — "Exit Presenter?" before ending. */
  const confirmEnd = useCallback(
    (id?: string) => {
      void (async () => {
        if (await dlg.confirm("Exit Presenter?")) await endSession(id);
      })();
    },
    [dlg, endSession],
  );

  useEffect(() => {
    if (!session || !controlling) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = e.key;
      let handled = true;
      if (key === "ArrowDown" || key === " " || key === "PageDown") void doNavigate("next");
      else if (key === "ArrowUp" || key === "PageUp") void doNavigate("prev");
      else if (key === "Home") { if (plan?.slides[0]) void doNavigate("jump", plan.slides[0].index); }
      else if (key === "End") { const last = plan?.slides[plan.slides.length - 1]; if (last) void doNavigate("jump", last.index); }
      else if (key === "ArrowRight") jumpToItem(1);
      else if (key === "ArrowLeft" || key === "Backspace") prevSection();
      else if (key === "Escape") confirmEnd();
      else if (/^F(\d|1[0-5])$/.test(key)) {
        const n = parseInt(key.slice(1), 10);
        const ids = [...new Set((plan?.slides ?? []).map((s) => s.itemId))];
        const id = ids[n - 1];
        const target = plan?.slides.find((s) => s.itemId === id);
        if (target) void doNavigate("jump", target.index);
      } else if (/^[1-9]$/.test(key)) {
        jumpToSection((s) => s.prefix === key || s.sectionLabel?.toLowerCase() === `v${key}`);
      } else {
        // OpenSong mode keys are toggles — pressing the active mode's key returns to normal.
        const toggle = (m: PresentMode) => setMode(session.mode === m ? "normal" : m);
        const mk = key.toLowerCase();
        switch (mk) {
          case "n": setMode("normal"); break;
          case "k": toggle("blank"); break;
          case "w": toggle("white"); break;
          case "h": toggle("hidden"); break;
          case "l": toggle("logo"); break;
          case "f": toggle("freeze"); break;
          case "a": alertRef.current?.focus(); break;
          case "q": openAdd("song"); break;
          case "s": openAdd("scripture"); break;
          case "m": toggleFullscreen(); break;
          case "`": // backtick = Chorus, same as C
          case "c": jumpToSection((s) => s.sectionLabel?.toLowerCase().startsWith("c") ?? false); break;
          case "p": jumpToSection((s) => s.sectionLabel?.toLowerCase().startsWith("p") ?? false); break;
          case "b": jumpToSection((s) => s.sectionLabel?.toLowerCase().startsWith("b") ?? false); break;
          case "t": jumpToSection((s) => s.sectionLabel?.toLowerCase().startsWith("t") ?? false); break;
          default: handled = false;
        }
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, controlling, plan, doNavigate, jumpToItem, prevSection, jumpToSection, setMode, toggleFullscreen, leave, confirmEnd, openAdd]);

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

  const insertItems = async (items: ServiceItem[]) => {
    if (!session?.serviceId) return;
    const svc = await api.service(session.serviceId);
    const curItem = plan?.slides[plan.current]?.itemId;
    const at = svc.items.findIndex((i) => i.id === curItem);
    svc.items.splice(at === -1 ? svc.items.length : at + 1, 0, ...items);
    await api.saveService(svc);
    await refreshPlan(session.id);
  };

  const makeReceiverUrl = async () => {
    if (!session) return;
    const { token } = await api.guestToken(session.id, ["view"]);
    setReceiverUrl(`${window.location.origin}/receiver?session=${session.id}&token=${token}`);
  };

  if (!session) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <h1 className="mb-3 text-lg font-semibold">Present</h1>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select id="svc-pick" className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <option value="">Pick a service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const svc = services.find((s) => s.id === (document.getElementById("svc-pick") as HTMLSelectElement).value);
                if (svc) void startFor(svc);
              }}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500"
            >
              Start session
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  const shownSlide = slide?.mode === "freeze" ? frozen ?? slide : slide;
  const activeMode: PresentMode = slide?.blanked ? "blank" : slide?.mode ?? "normal";
  const curPlanSlide = plan?.slides[plan.current];

  // OpenSong lst_all_slides: one row PER SLIDE (the screenshot shows V1
  // twice when || splits it). Title shows on every row; the 4px top border
  // marks each new set item.
  const listRows = (plan?.slides ?? []).map((s, i, all) => ({
    key: `${s.index}`,
    itemId: s.itemId,
    itemTitle: s.itemTitle,
    kind: s.itemKind,
    slideId: s.blank ? "" : (s.slideId ?? String(s.slideInItem)),
    firstLine: s.blank ? "" : s.firstLine,
    blank: s.blank,
    blankTitle: s.blank ? s.itemTitle : "",
    index: s.index,
    // OpenSong @emphasize (chorus) bolds the ID cell.
    emphasized: s.slideId !== null && !/^[v]/i.test(s.slideId),
    loop: s.loopSeconds > 0,
    newGroup: i === 0 || all[i - 1]!.itemId !== s.itemId,
  }));
  const curRow = plan?.current ?? -1;
  const MODES: { key: string; mode: PresentMode; label: string }[] = [
    { key: "N", mode: "normal", label: "Normal" },
    { key: "K", mode: "blank", label: "Black" },
    { key: "W", mode: "white", label: "White" },
    { key: "H", mode: "hidden", label: "Hidden" },
    { key: "L", mode: "logo", label: "Logo" },
    { key: "F", mode: "freeze", label: "Frozen" },
  ];

  return (
    <div className="flex h-screen flex-col p-2">
      {/* Title strip — OpenSong's helper shows only the window caption. */}
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="font-semibold">Presentation Helper</span>
        <span className="text-zinc-500">—</span>
        <span className="font-medium">{session.name}</span>
        <span className="text-xs text-zinc-500">{slide?.status}</span>
        {controlling && (
          <span className="ml-auto rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">In control</span>
        )}
      </div>
      {receiverUrl && <p className="mb-1 break-all rounded bg-zinc-100 p-1 font-mono text-xs dark:bg-zinc-900">{receiverUrl}</p>}
      {error && <p className="mb-1 text-xs text-red-600">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-2">
        {/* Left column: slide list / notes / previews */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* lst_all_slides — Title | ID | Text (27% / 8% / 65%) */}
          <div className="min-h-0 flex-1 overflow-auto rounded border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-zinc-100 text-left dark:bg-zinc-900">
                <tr>
                  <th className="w-[27%] px-2 py-1 font-semibold">Title</th>
                  <th className="w-[8%] px-1 py-1 font-semibold">ID</th>
                  <th className="w-[65%] px-2 py-1 font-semibold">Text</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((r, i) => {
                  const cur = i === curRow;
                  // Alternating shading distinguishes consecutive rows (OpenSong listbox).
                  const alt = i % 2 === 1 && !cur ? "bg-sky-50 dark:bg-sky-950/40" : "";
                  return (
                    <tr
                      key={r.key}
                      ref={cur ? curRowRef : undefined}
                      onClick={() => controlling && void doNavigate("jump", r.index)}
                      className={`cursor-pointer select-none ${
                        r.newGroup && i > 0 ? "[&>td]:border-t-4 [&>td]:border-zinc-300 dark:[&>td]:border-zinc-600" : ""
                      } ${cur ? "bg-indigo-100 dark:bg-indigo-950" : `${alt} hover:bg-zinc-50 dark:hover:bg-zinc-900`}`}
                    >
                      <td className="px-2 py-1 font-medium">
                        {r.blank ? " " : r.loop ? `(Loop) ${r.itemTitle}` : r.itemTitle}
                      </td>
                      <td className={`px-1 py-1 text-center ${r.emphasized ? "font-bold" : ""}`}>{r.slideId}</td>
                      <td className="truncate px-2 py-1">{r.firstLine}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* edt_slide_notes */}
          <textarea
            readOnly
            value={curPlanSlide?.itemNotes ?? shownSlide?.slide?.lines.join("\n") ?? ""}
            className="h-16 shrink-0 resize-none rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            placeholder="Slide notes"
          />

          {/* cnv_preview + cnv_preview_next */}
          <div className="flex shrink-0 gap-2">
            <div className="flex-1">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Current slide preview</p>
              {shownSlide?.slide ? (
                <div className="aspect-video w-full overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
                  <SlideCanvas
                    title={shownSlide.slide.title}
                    lines={shownSlide.slide.lines}
                    style={shownSlide.slide.style}
                    backgroundKey={shownSlide.slide.backgroundKey}
                    backgroundAsText={shownSlide.slide.backgroundAsText}
                    mediaKey={shownSlide.slide.mediaKey}
                    logoKey={shownSlide.slide.logoKey}
                    mode={activeMode}
                    blanked={shownSlide.blanked}
                    next={shownSlide.slide.next}
                  />
                </div>
              ) : (
                <div className="aspect-video w-full rounded border border-zinc-300 bg-black dark:border-zinc-700" />
              )}
            </div>
            <div className="flex-1">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Next slide preview</p>
              {slide?.slide?.next ? (
                <div className="aspect-video w-full overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
                  <SlideCanvas
                    title={slide.slide.next.title}
                    lines={slide.slide.next.lines}
                    style={slide.slide.style}
                  />
                </div>
              ) : (
                <div className="aspect-video w-full rounded border border-zinc-300 bg-black dark:border-zinc-700" />
              )}
            </div>
          </div>
        </div>

        {/* Right column: Mode / Actions / keys */}
        <div className="flex w-40 shrink-0 flex-col gap-2">
          <fieldset className="rounded border border-zinc-300 p-1.5 dark:border-zinc-700">
            <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Mode</legend>
            <div className="flex flex-col gap-1">
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  disabled={!controlling}
                  onClick={() => setMode(m.mode)}
                  className={`${btn} ${activeMode === m.mode ? "bg-indigo-100 font-semibold dark:bg-indigo-950" : ""}`}
                >
                  [{m.key}] {m.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded border border-zinc-300 p-1.5 dark:border-zinc-700">
            <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Actions</legend>
            <div className="flex flex-col gap-1">
              {!controlling && (
                <button onClick={() => void takeControl()} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>
                  Take control
                </button>
              )}
              <button disabled={!controlling} onClick={() => alertRef.current?.focus()} className={btn}>[A] Alert</button>
              <input
                ref={alertRef}
                value={alertText}
                onChange={(e) => setAlertText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && session) {
                    void api.setAlert(session.id, alertText || null).then(() => refreshSlide(session.id));
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Alert text…"
                className="rounded border border-zinc-300 bg-transparent px-2 py-0.5 text-xs dark:border-zinc-700"
              />
              {slide?.alert && (
                <button
                  disabled={!controlling}
                  onClick={() => {
                    setAlertText("");
                    if (session) void api.setAlert(session.id, null).then(() => refreshSlide(session.id));
                  }}
                  className={`${btn} text-amber-600`}
                >
                  Clear alert
                </button>
              )}
              <button disabled={!controlling || !session.serviceId} onClick={() => openAdd("song")} className={btn}>
                [Q] Add Song
              </button>
              <button disabled={!controlling || !session.serviceId} onClick={() => openAdd("scripture")} className={btn}>
                [S] Scripture
              </button>
              <button onClick={toggleFullscreen} className={btn}>[M] {fullscreen ? "Normal Screen" : "Full Screen"}</button>
              <button onClick={() => void makeReceiverUrl()} className={btn}>Receiver link</button>
              <a href="/stage" target="_blank" rel="noreferrer" className={`${btn} block text-center`}>Stage view</a>
              <button onClick={() => confirmEnd()} className={btn}>[Esc] End</button>
            </div>
          </fieldset>

          <pre className="rounded border border-zinc-300 p-1.5 text-[10px] leading-snug whitespace-pre-wrap text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
{"- Keys -\nSpace/Down/PgDn: Next\nUp/PgUp: Previous\nRight: Next Section\nLeft/Backspace: Prev Section\nHome/End: First/Last Slide\nF1-F15: Song\n1-9: Verse\nC/`: Chorus\nP: Pre-chorus\nB: Bridge\nT: Tag\nK/W/H/L/F: Black/White/Hide/Logo/Freeze\nN: Normal\nA: Alert\nQ: Add Song\nS: Scripture\nM: Full Screen\nEsc: End"}
          </pre>
        </div>
      </div>

      {addTab !== null && (
        <AddItemDialog tab={addTab} onTabChange={setAddTab} onAdd={insertItems} onClose={() => setAddTab(null)} />
      )}
    </div>
  );
}
