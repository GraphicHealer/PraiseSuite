import { useRef, type ReactNode } from "react";

/**
 * In-app print preview: loads a server-rendered print document in an iframe
 * and calls its print() — works in Electron and plain browsers alike
 * (window.open is unreliable under Electron).
 */
export function PrintPreview({ url, onClose }: { url: string; onClose: () => void }): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/80">
      <div className="flex items-center gap-3 border-b border-zinc-700 bg-zinc-900 px-4 py-2">
        <span className="text-sm font-medium text-zinc-100">Print preview</span>
        <button
          onClick={() => frameRef.current?.contentWindow?.print()}
          className="ml-auto rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500"
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
