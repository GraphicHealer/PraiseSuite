import { useState, type ReactNode } from "react";
import { expandZip } from "@praisesuite/core";
import { api, type ImportFilePayload, type ImportPreview, type ImportReport } from "../api.js";

const btn =
  "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function ImportPage(): ReactNode {
  const [files, setFiles] = useState<ImportFilePayload[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [dupAction, setDupAction] = useState<"skip" | "replace" | "import">("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (list: FileList | null) => {
    if (!list) return;
    const out: ImportFilePayload[] = [];
    for (const f of Array.from(list)) {
      if (f.name.toLowerCase().endsWith(".zip")) {
        const expanded = expandZip(new Uint8Array(await f.arrayBuffer()));
        out.push(...expanded.map((e) => ({ path: `${f.name}/${e.path}`, text: e.text })));
      } else {
        out.push({ path: f.webkitRelativePath || f.name, text: await f.text() });
      }
    }
    setFiles(out);
    setPreview(null);
    setReport(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-3 text-lg font-semibold">Import OpenSong library</h1>
      <div className="mb-4 rounded border border-dashed border-zinc-300 p-4 text-sm dark:border-zinc-700">
        <p className="mb-2 text-zinc-500">Pick song/set files, a folder, or a zip archive.</p>
        <div className="flex gap-3">
          <label className={btn}>
            Files…
            <input type="file" multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
          </label>
          <label className={btn}>
            Folder…
            <input
              type="file"
              // @ts-expect-error nonstandard but supported by Chromium/WebView
              webkitdirectory=""
              className="hidden"
              onChange={(e) => void pick(e.target.files)}
            />
          </label>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm">{files.length} file(s) staged</span>
          <button
            disabled={busy}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
            onClick={() => void run(async () => setPreview(await api.importPreview(files)))}
          >
            Analyze
          </button>
        </div>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {preview && (
        <div className="mb-4 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 font-medium">
            {preview.songs.filter((s) => s.title).length} songs, {preview.sets.length} set(s),{" "}
            {preview.skipped.length} skipped, {preview.duplicates} duplicate(s)
          </h2>
          {preview.songs.some((s) => s.warnings.length > 0 || s.error) && (
            <details className="mb-2 text-xs text-amber-600">
              <summary>Warnings / errors</summary>
              <ul className="mt-1 list-disc pl-5">
                {preview.songs
                  .flatMap((s) => [...s.warnings.map((w) => `${s.path}: ${w}`), ...(s.error ? [`${s.path}: ${s.error}`] : [])])
                  .map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
              </ul>
            </details>
          )}
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span>Duplicates:</span>
            {(["skip", "replace", "import"] as const).map((a) => (
              <label key={a} className="flex items-center gap-1">
                <input type="radio" checked={dupAction === a} onChange={() => setDupAction(a)} />
                {a}
              </label>
            ))}
          </div>
          <button
            disabled={busy}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
            onClick={() =>
              void run(async () => setReport(await api.importRun(files, dupAction)))
            }
          >
            Import
          </button>
        </div>
      )}

      {report && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          Imported {report.importedSongs} song(s) and {report.importedSets} set(s);{" "}
          {report.skippedFiles} skipped, {report.failed.length} failed.
          {report.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
