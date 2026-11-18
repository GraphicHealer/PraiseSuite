import { useRef, useState, type ReactNode } from "react";

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
 * In-app print preview: loads a server-rendered print document in an iframe.
 * Print routes through Electron's native webContents.print when the desktop
 * bridge is present (OS print dialog); browsers fall back to iframe.print().
 * "Save as PDF" uses webContents.printToPDF — Electron only.
 */
export function PrintPreview({ url, filename, onClose }: { url: string; filename?: string; onClose: () => void }): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState(false);
  const pdf = window.ps?.printToPdf !== undefined;
  const pdfName = filename ?? "document.pdf";

  const doPrint = async () => {
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
    setBusy(true);
    try {
      await window.ps?.printToPdf(url, pdfName);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/80">
      <div className="flex items-center gap-3 border-b border-zinc-700 bg-zinc-900 px-4 py-2">
        <span className="text-sm font-medium text-zinc-100">Print preview</span>
        {pdf && (
          <button
            onClick={() => void doPdf()}
            disabled={busy}
            className="ml-auto rounded border border-indigo-500 px-3 py-1 text-sm font-medium text-indigo-300 hover:bg-indigo-950 disabled:opacity-50"
          >
            Save as PDF
          </button>
        )}
        <button
          onClick={() => void doPrint()}
          disabled={busy}
          className={`${pdf ? "" : "ml-auto"} rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50`}
        >
          Print…
        </button>
        <button
          onClick={onClose}
          className="rounded border border-zinc-600 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Close
        </button>
      </div>
      <iframe ref={frameRef} src={url} className="min-h-0 flex-1 bg-white" title="Print preview" />
    </div>
  );
}
