import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mdiMagnifyMinus, mdiMagnifyPlus, mdiMinus, mdiPlus } from "@mdi/js";
import { Previewer } from "pagedjs";
import { Icon } from "./components/Icon.js";

declare global {
  interface Window {
    /** Electron preload bridge (apps/desktop/src/preload.mjs) — undefined in browsers. */
    ps?: {
      print: (url: string) => Promise<void>;
      printToPdf: (url: string, filename: string) => Promise<string | null>;
      openPrintWindow: (query: string) => Promise<void>;
    };
  }
}

export interface PrintPreviewRequest {
  /** Server print URL — token already appended via api.printUrl(). */
  url: string;
  filename?: string;
  /** POSTed once when the user prints (activity log). */
  logUrl?: string;
}

/**
 * Open the print preview as a real popup window — its own BrowserWindow on
 * desktop, window.open in a browser. The window loads the app with
 * ?print=<params> and renders PrintWindow below.
 */
export function openPrintPreview(req: PrintPreviewRequest): void {
  const q = new URLSearchParams({ print: req.url });
  if (req.filename !== undefined) q.set("name", req.filename);
  if (req.logUrl !== undefined) q.set("log", req.logUrl);
  if (window.ps?.openPrintWindow) {
    void window.ps.openPrintWindow(q.toString());
  } else {
    window.open(`/?${q.toString()}`, "praisesuite-print", "width=1180,height=840");
  }
}

/** Page chrome for the on-screen paged.js sheets (does not print): white
 *  paper on the dark canvas — light-mode rendering inside the page even when
 *  the app is in dark mode, sized by the document's own @page box. */
const PREVIEW_CSS = `
  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px 0; }
  .pagedjs_page {
    background: #fff; color: #000; color-scheme: light; flex: none;
    box-shadow: 0 2px 12px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25);
  }
  .pagedjs_sheet, .pagedjs_pagebox { background: #fff; color: #000; }
`;

const FONT_OPTIONS = [
  "Arial", "Arial Narrow", "Times New Roman", "Georgia", "Courier New",
  "Verdana", "Trebuchet MS", "Inter", "Source Serif 4", "JetBrains Mono",
];

/** OpenSong PrintSettings roles (order = the window's role list). */
const ROLES: [string, string][] = [
  ["title", "Title"], ["author", "Author"], ["heading", "Heading"],
  ["chords", "Chords"], ["capo_chords", "Capo chords"], ["lyrics", "Lyrics"],
  ["lyrics_language2", "Lyrics (2nd lang.)"], ["copyright", "Copyright"],
];

type Tri = "" | "1" | "0";
/** Fields the user touched for one role; empty = server/imported default. */
interface RoleEdit { font?: string; size?: string; color?: string; bold?: Tri; italic?: Tri; underline?: Tri }

interface Options {
  transpose: number;
  capo: string;
  landscape: boolean;
  margin: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  capsTitle: Tri; chorus: Tri; adorn: Tri; border: string;
  hideChords: boolean; hideCapo: boolean; hideLang2: boolean; order: boolean;
  roles: Record<string, RoleEdit>;
}

const DEFAULT_OPTS: Options = {
  transpose: 0, capo: "", landscape: false,
  margin: "", marginTop: "", marginRight: "", marginBottom: "", marginLeft: "",
  capsTitle: "", chorus: "", adorn: "", border: "",
  hideChords: false, hideCapo: false, hideLang2: false, order: false,
  roles: {},
};

/** Base print URL + option params -> effective document URL. */
function effectiveUrl(base: string, o: Options): string {
  const sep = base.includes("?") ? "&" : "?";
  const p = new URLSearchParams();
  if (o.transpose !== 0) p.set("transpose", String(o.transpose));
  if (o.capo !== "") p.set("capo", o.capo);
  if (o.landscape) p.set("landscape", "1");
  for (const [k, v] of [["margin", o.margin], ["marginTop", o.marginTop], ["marginRight", o.marginRight], ["marginBottom", o.marginBottom], ["marginLeft", o.marginLeft], ["border", o.border]] as const) {
    if (v !== "") p.set(k, v);
  }
  for (const [k, v] of [["capsTitle", o.capsTitle], ["chorus", o.chorus], ["adorn", o.adorn]] as const) {
    if (v !== "") p.set(k, v);
  }
  if (o.hideChords) p.set("hideChords", "1");
  if (o.hideCapo) p.set("hideCapo", "1");
  if (o.hideLang2) p.set("hideLang2", "1");
  if (o.order) p.set("order", "1");
  for (const [role, e] of Object.entries(o.roles)) {
    for (const [prop, v] of Object.entries(e)) {
      if (v !== undefined && v !== "") p.set(`r_${role}_${prop}`, v);
    }
  }
  const s = p.toString();
  return s === "" ? base : `${base}${sep}${s}`;
}

/**
 * Chrome-style print preview window: options panel left, rendered paper
 * sheets right. paged.js paginates the fetched print document into real
 * @page-sized boxes in this document (same engine Chrome's preview emulates).
 */
export function PrintWindow({ params }: { params: URLSearchParams }): ReactNode {
  const baseUrl = params.get("print") ?? "";
  const filename = params.get("name") ?? "document.pdf";
  const logUrl = params.get("log") ?? undefined;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTS);
  const [roleSel, setRoleSel] = useState("chords");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logged = useRef(false);

  const url = useMemo(() => effectiveUrl(baseUrl, opts), [baseUrl, opts]);

  // Fetch + paginate whenever the effective URL changes.
  useEffect(() => {
    let cancelled = false;
    setPageCount(null);
    setError("");
    (async () => {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        doc.querySelectorAll(".no-print").forEach((el) => el.remove());
        // paged.js add() treats a bare string as a URL to fetch — inline CSS
        // must be wrapped as {name: cssText} or it XHRs the CSS itself.
        const styles = [...doc.querySelectorAll("style")].map((s, i) => ({ [`inline-${i}`]: s.textContent ?? "" }));
        styles.push({ preview: PREVIEW_CSS });
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = "";
        const flow = await new Previewer().preview(doc.body.innerHTML, styles, hostRef.current);
        if (!cancelled) setPageCount(flow.total);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const logPrint = () => {
    if (logUrl !== undefined && !logged.current) {
      logged.current = true;
      void fetch(logUrl, { method: "POST", credentials: "include" }).catch(() => {});
    }
  };

  const doPrint = async () => {
    logPrint();
    if (window.ps?.print) {
      setBusy(true);
      try {
        await window.ps.print(url);
      } finally {
        setBusy(false);
      }
      return;
    }
    // Browser: print the raw document through a hidden iframe.
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.src = url;
    frame.onload = () => frame.contentWindow?.print();
    document.body.appendChild(frame);
  };

  const doPdf = async () => {
    logPrint();
    setBusy(true);
    try {
      await window.ps?.printToPdf(url, filename);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Options>(k: K, v: Options[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const roleEdit = opts.roles[roleSel] ?? {};
  const setRole = (prop: keyof RoleEdit, v: string) =>
    setOpts((o) => {
      const cur = { ...(o.roles[roleSel] ?? {}) };
      if (v === "") delete cur[prop]; else (cur as Record<string, string>)[prop] = v;
      const roles = { ...o.roles };
      if (Object.keys(cur).length === 0) delete roles[roleSel]; else roles[roleSel] = cur;
      return { ...o, roles };
    });
  const label = "block text-xs font-medium text-zinc-400 mb-1";
  const input = "w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100";

  const fontSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">Default</option>
      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  );

  return (
    <div className="flex h-screen bg-zinc-900 text-zinc-100">
      {/* Options panel — Chrome print preview layout, app styling. */}
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-700 bg-zinc-950 p-4">
        <div>
          <h1 className="text-lg font-semibold">Print</h1>
          <p className="text-xs text-zinc-400">{pageCount === null ? "paginating…" : `${pageCount} sheet${pageCount === 1 ? "" : "s"} of paper`}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => void doPrint()}
            disabled={busy || pageCount === null}
            className="flex-1 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Print…
          </button>
          {window.ps?.printToPdf && (
            <button
              onClick={() => void doPdf()}
              disabled={busy}
              className="flex-1 rounded border border-indigo-500 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-950 disabled:opacity-50"
            >
              Save as PDF
            </button>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className={label}>Layout</legend>
          <div className="flex gap-1">
            {([["Portrait", false], ["Landscape", true]] as const).map(([name, v]) => (
              <button
                key={name}
                onClick={() => set("landscape", v)}
                className={`flex-1 rounded border px-2 py-1 text-sm ${opts.landscape === v ? "border-indigo-500 bg-indigo-950 text-indigo-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {([["marginTop", "Top"], ["marginBottom", "Bot."], ["marginLeft", "Left"], ["marginRight", "Right"]] as const).map(([k, name]) => (
              <div key={k}>
                <label htmlFor={k} className={label}>{name}</label>
                <input id={k} type="number" min={0} max={200} value={opts[k]} placeholder="72" onChange={(e) => set(k, e.target.value)} className={input} title={`${name} margin (pt)`} />
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className={label}>Style</legend>
          {([["capsTitle", "Title in CAPS"], ["chorus", "Highlight choruses"], ["adorn", "Adorn section titles"]] as const).map(([k, name]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <select value={opts[k]} onChange={(e) => set(k, e.target.value as Tri)} className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-xs text-zinc-100">
                <option value="">Default</option><option value="1">On</option><option value="0">Off</option>
              </select>
              {name}
            </label>
          ))}
          <div className="flex items-center gap-2">
            <span className="text-sm">Border thickness</span>
            <input type="number" min={0} max={10} value={opts.border} placeholder="2" onChange={(e) => set("border", e.target.value)} className={`${input} w-16`} />
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className={label}>Hide</legend>
          {([["hideChords", "Chords"], ["hideCapo", "Capo chords"], ["hideLang2", "2nd-language lyrics"]] as const).map(([k, name]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={opts[k]} onChange={(e) => set(k, e.target.checked)} />
              {name}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={opts.order} onChange={(e) => set("order", e.target.checked)} />
            Print in presentation order
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={label}>Role styles</legend>
          <select value={roleSel} onChange={(e) => setRoleSel(e.target.value)} className={input}>
            {ROLES.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="rFont" className={label}>Font</label>
              {fontSelect(roleEdit.font ?? "", (v) => setRole("font", v), "rFont")}
            </div>
            <div>
              <label htmlFor="rSize" className={label}>Size (pt)</label>
              <input id="rSize" type="number" min={6} max={40} value={roleEdit.size ?? ""} placeholder="11" onChange={(e) => setRole("size", e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="rColor" className={label}>Color</label>
              <div className="flex gap-1">
                <input id="rColor" type="color" value={roleEdit.color ?? "#000000"} onChange={(e) => setRole("color", e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-zinc-700 bg-zinc-800" />
                {roleEdit.color !== undefined && <button onClick={() => setRole("color", "")} className="text-xs text-zinc-400 hover:text-zinc-200">reset</button>}
              </div>
            </div>
            <div className="flex items-end gap-2 pb-1">
              {([["bold", "B", "font-bold"], ["italic", "I", "italic"], ["underline", "U", "underline"]] as const).map(([k, t, cls]) => (
                <select key={k} value={roleEdit[k] ?? ""} onChange={(e) => setRole(k, e.target.value as Tri)} title={k} className={`rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-xs text-zinc-100 ${cls}`}>
                  <option value="">·</option><option value="1">{t}</option><option value="0">/{t}</option>
                </select>
              ))}
            </div>
          </div>
          {Object.keys(opts.roles).length > 0 && (
            <button onClick={() => set("roles", {})} className="text-xs text-zinc-400 hover:text-zinc-200">Reset all role styles</button>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={label}>Music</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className={label}>Transpose</span>
              <div className="flex items-center gap-1">
                <button onClick={() => set("transpose", opts.transpose - 1)} className="w-7 rounded border border-zinc-700 px-1 text-sm hover:bg-zinc-800"><Icon path={mdiMinus} /></button>
                <span className="w-8 text-center text-sm">{opts.transpose > 0 ? `+${opts.transpose}` : opts.transpose}</span>
                <button onClick={() => set("transpose", opts.transpose + 1)} className="w-7 rounded border border-zinc-700 px-1 text-sm hover:bg-zinc-800"><Icon path={mdiPlus} /></button>
              </div>
            </div>
            <div>
              <label htmlFor="capo" className={label}>Capo</label>
              <select id="capo" value={opts.capo} onChange={(e) => set("capo", e.target.value)} className={input}>
                <option value="">Song default</option>
                <option value="0">None</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <button onClick={() => window.close()} className="mt-auto rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
          Close
        </button>
      </aside>

      {/* Rendered sheets. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-end gap-1 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5">
          <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} className="rounded border border-zinc-700 px-2 text-sm text-zinc-300 hover:bg-zinc-800"><Icon path={mdiMagnifyMinus} /></button>
          <span className="w-12 text-center text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.15))} className="rounded border border-zinc-700 px-2 text-sm text-zinc-300 hover:bg-zinc-800"><Icon path={mdiMagnifyPlus} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-zinc-800">
          {error !== "" ? (
            <p className="p-4 text-sm text-red-400">Preview failed: {error}</p>
          ) : (
            <div ref={hostRef} style={{ zoom }} />
          )}
        </div>
      </div>
    </div>
  );
}
