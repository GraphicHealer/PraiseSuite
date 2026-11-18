import { useEffect, useRef, useState, type ReactNode } from "react";
import { Previewer } from "pagedjs";

declare global {
  interface Window {
    /** Electron preload bridge (apps/desktop/src/preload.mjs) — undefined in browsers. */
    ps?: {
      print: (url: string) => Promise<void>;
      printToPdf: (url: string, filename: string) => Promise<string | null>;
    };
  }
}

/** Page chrome for the on-screen paged.js preview (does not print). */
const PREVIEW_CSS = `
  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 24px 0; }
  .pagedjs_page {
    background: white; color: black;
    box-shadow: 0 2px 10px rgba(0,0,0,.35);
    flex: none;
  }
`;

/**
 * Paginated print preview: the server-rendered print document is fetched and
 * run through paged.js, which lays it out into real @page-sized page boxes —
 * the same pagination the printer will see.
 *
 * Print routes through Electron's native webContents.print when the desktop
 * bridge is present (OS print dialog); browsers print a hidden iframe holding
 * the original document. "Save as PDF" uses webContents.printToPDF.
 */
export function PrintPreview({ url, filename, logUrl, onClose }: { url: string; filename?: string; logUrl?: string; onClose: () => void }): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const pdf = window.ps?.printToPdf !== undefined;
  const pdfName = filename ?? "document.pdf";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const html = await (await fetch(url, { credentials: "include" })).text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        // The "open browser Print" helper banner is only chrome — not content.
        doc.querySelectorAll(".no-print").forEach((el) => el.remove());
        const styles = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "");
        styles.push(PREVIEW_CSS);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = "";
        const flow = await new Previewer().preview(doc.body, styles, hostRef.current);
        if (!cancelled) {
          setPageCount(flow.total);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  /** Fire-and-forget activity log entry (printed) — once per preview open. */
  const logged = useRef(false);
  const logPrint = () => {
    if (logUrl && !logged.current) {
      logged.current = true;
      void fetch(logUrl, { method: "POST", credentials: "include" }).catch(() => {});
    }
  };

  const doPrint = async () => {
    logPrint();
    if (window.ps) {
      setBusy(true);
      try {
        await window.ps.print(url);
      } finally {
        setBusy(false);
      }
    } else {
      frameRef.current?.contentWindow?.print();
    }
  };

  const doPdf = async () => {
    logPrint();
    setBusy(true);
    try {
      await window.ps?.printToPdf(url, pdfName);
    } finally {
      setBusy(false);
    }
  };

  const btn =
    "rounded border border-zinc-600 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/80">
      <div className="flex items-center gap-3 border-b border-zinc-700 bg-zinc-900 px-4 py-2">
        <span className="text-sm font-medium text-zinc-100">Print preview</span>
        <span className="text-xs text-zinc-400">{loading ? "paginating…" : `${pageCount} page${pageCount === 1 ? "" : "s"}`}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className={btn} title="Zoom out">−</button>
          <span className="w-12 text-center text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))} className={btn} title="Zoom in">+</button>
        </div>
        {pdf && (
          <button
            onClick={() => void doPdf()}
            disabled={busy}
            className="rounded border border-indigo-500 px-3 py-1 text-sm font-medium text-indigo-300 hover:bg-indigo-950 disabled:opacity-50"
          >
            Save as PDF
          </button>
        )}
        <button
          onClick={() => void doPrint()}
          disabled={busy}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Print…
        </button>
        <button onClick={onClose} className={btn}>Close</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error !== "" && <p className="p-4 text-sm text-red-400">Preview failed: {error}</p>}
        <div
          ref={hostRef}
          className="origin-top transition-transform"
          style={{ transform: `scale(${zoom})` }}
        />
      </div>
      {/* Hidden frame used for browser printing (Electron prints natively).
          Kept rendered but invisible — display:none iframes can't print in some browsers. */}
      {!pdf && <iframe ref={frameRef} src={url} className="pointer-events-none absolute h-0 w-0 border-0 opacity-0" title="print" />}
    </div>
  );
}
