import { useEffect, useRef, useState, type ReactNode } from "react";

/** Vendored paged.js polyfill (apps/web/public/vendor/) — its package
 *  `exports` map doesn't expose dist files, so it's served as a static asset. */
const POLYFILL_URL = "/vendor/paged.polyfill.js";

declare global {
  interface Window {
    /** Electron preload bridge (apps/desktop/src/preload.mjs) — undefined in browsers. */
    ps?: {
      print: (url: string) => Promise<void>;
      printToPdf: (url: string, filename: string) => Promise<string | null>;
    };
  }
}

/**
 * Paginated print preview: the server-rendered print document is loaded into
 * an iframe with the paged.js polyfill appended, which lays the content out
 * into real @page-sized page boxes (white sheets with margins and shadows) —
 * the same pagination the printer sees.
 *
 * Print routes through Electron when the desktop bridge is present:
 * ps.print() renders a PDF and opens it in the default PDF viewer (Windows'
 * system print dialog can't show a preview for Electron anyway); browsers
 * print the paginated iframe directly. "Save as PDF" uses printToPDF.
 */
export function PrintPreview({ url, filename, logUrl, onClose }: { url: string; filename?: string; logUrl?: string; onClose: () => void }): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [srcDoc, setSrcDoc] = useState("");
  const [error, setError] = useState("");
  const pdf = window.ps?.printToPdf !== undefined;
  const pdfName = filename ?? "document.pdf";

  // Fetch the print document and append the paged.js polyfill — it paginates
  // the document in place and injects its own page chrome (.pagedjs_page).
  useEffect(() => {
    let cancelled = false;
    setError("");
    setSrcDoc("");
    void fetch(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((html) => {
        if (cancelled) return;
        // Strip non-print chrome (e.g. the "use Ctrl+P" banner) so paged.js
        // only paginates the actual document pages.
        const parsed = new DOMParser().parseFromString(html, "text/html");
        parsed.querySelectorAll(".no-print").forEach((el) => el.remove());
        const script = parsed.createElement("script");
        script.src = POLYFILL_URL;
        parsed.body.appendChild(script);
        setSrcDoc(`<!doctype html>${parsed.documentElement.outerHTML}`);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Page count: paged.js emits "rendered" on its previewer; poll as fallback.
  useEffect(() => {
    if (srcDoc === "") return;
    setPageCount(null);
    const t = setInterval(() => {
      const pages = frameRef.current?.contentDocument?.querySelectorAll(".pagedjs_page").length;
      if (pages && pages > 0) {
        setPageCount(pages);
        clearInterval(t);
      }
    }, 300);
    const stop = setTimeout(() => clearInterval(t), 15000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [srcDoc]);

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
      // The iframe holds the paged.js-paginated document — printing it gives
      // the same page boxes the preview shows.
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
        <span className="text-xs text-zinc-400">
          {pageCount === null ? "paginating…" : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
        </span>
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
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-800/60">
        {error !== "" ? (
          <p className="p-4 text-sm text-red-400">Preview failed: {error}</p>
        ) : (
          <iframe
            ref={frameRef}
            srcDoc={srcDoc}
            className="mx-auto block h-full w-full border-0"
            title="Print preview"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
            }}
          />
        )}
      </div>
    </div>
  );
}
