import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Previewer } from "pagedjs";

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

interface Options {
  transpose: number;
  capo: string;
  landscape: boolean;
  cFont: string;
  cSize: string;
  cColor: string;
  cBold: boolean;
  cItalic: boolean;
  lFont: string;
  lSize: string;
}

const DEFAULT_OPTS: Options = {
  transpose: 0, capo: "", landscape: false,
  cFont: "", cSize: "", cColor: "", cBold: false, cItalic: false,
  lFont: "", lSize: "",
};

/** Base print URL + option params -> effective document URL. */
function effectiveUrl(base: string, o: Options): string {
  const sep = base.includes("?") ? "&" : "?";
  const p = new URLSearchParams();
  if (o.transpose !== 0) p.set("transpose", String(o.transpose));
  if (o.capo !== "") p.set("capo", o.capo);
  if (o.landscape) p.set("landscape", "1");
  if (o.cFont !== "") p.set("cFont", o.cFont);
  if (o.cSize !== "") p.set("cSize", o.cSize);
  if (o.cColor !== "") p.set("cColor", o.cColor);
  if (o.cBold) p.set("cBold", "1");
  if (o.cItalic) p.set("cItalic", "1");
  if (o.lFont !== "") p.set("lFont", o.lFont);
  if (o.lSize !== "") p.set("lSize", o.lSize);
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
        const styles = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "");
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = "";
        const flow = await new Previewer().preview(doc.body.innerHTML, [...styles, PREVIEW_CSS], hostRef.current);
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
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={label}>Chords</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="cFont" className={label}>Font</label>
              {fontSelect(opts.cFont, (v) => set("cFont", v), "cFont")}
            </div>
            <div>
              <label htmlFor="cSize" className={label}>Size (pt)</label>
              <input id="cSize" type="number" min={6} max={30} value={opts.cSize} placeholder="11" onChange={(e) => set("cSize", e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="cColor" className={label}>Color</label>
              <div className="flex gap-1">
                <input id="cColor" type="color" value={opts.cColor === "" ? "#000080" : opts.cColor} onChange={(e) => set("cColor", e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-zinc-700 bg-zinc-800" />
                {opts.cColor !== "" && <button onClick={() => set("cColor", "")} className="text-xs text-zinc-400 hover:text-zinc-200">reset</button>}
              </div>
            </div>
            <div className="flex items-end gap-3 pb-1">
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={opts.cBold} onChange={(e) => set("cBold", e.target.checked)} /> B</label>
              <label className="flex items-center gap-1 text-sm italic"><input type="checkbox" checked={opts.cItalic} onChange={(e) => set("cItalic", e.target.checked)} /> I</label>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={label}>Lyrics</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="lFont" className={label}>Font</label>
              {fontSelect(opts.lFont, (v) => set("lFont", v), "lFont")}
            </div>
            <div>
              <label htmlFor="lSize" className={label}>Size (pt)</label>
              <input id="lSize" type="number" min={6} max={30} value={opts.lSize} placeholder="12" onChange={(e) => set("lSize", e.target.value)} className={input} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={label}>Music</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className={label}>Transpose</span>
              <div className="flex items-center gap-1">
                <button onClick={() => set("transpose", opts.transpose - 1)} className="w-7 rounded border border-zinc-700 px-1 text-sm hover:bg-zinc-800">−</button>
                <span className="w-8 text-center text-sm">{opts.transpose > 0 ? `+${opts.transpose}` : opts.transpose}</span>
                <button onClick={() => set("transpose", opts.transpose + 1)} className="w-7 rounded border border-zinc-700 px-1 text-sm hover:bg-zinc-800">+</button>
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
          <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} className="rounded border border-zinc-700 px-2 text-sm text-zinc-300 hover:bg-zinc-800">−</button>
          <span className="w-12 text-center text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.15))} className="rounded border border-zinc-700 px-2 text-sm text-zinc-300 hover:bg-zinc-800">+</button>
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
