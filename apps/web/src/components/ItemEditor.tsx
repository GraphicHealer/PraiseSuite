import { useState, type ReactNode } from "react";
import type { ServiceItem } from "@praisesuite/core";

const input =
  "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const dlgBtn =
  "rounded border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";

const KEYS = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];

/**
 * Per-item editor (OpenSong's item-edit panel as a dialog): overrides that
 * apply to this item only in this set — name/notes, the slide_group attrs
 * (@presentation/@print/@transition/@seconds/@loop), per-kind extras
 * (image resize/keep_aspect, style-change action, song transpose).
 */
export function ItemEditor({
  item,
  songKey,
  onSave,
  onClose,
}: {
  item: ServiceItem;
  /** Resolved key of the linked song (for the transpose hint), if any. */
  songKey?: string | null | undefined;
  onSave: (item: ServiceItem) => void;
  onClose: () => void;
}): ReactNode {
  const [it, setIt] = useState<ServiceItem>(() => ({ ...item, config: { ...item.config } }));
  const cfg = it.config;
  const setCfg = (k: string, v: unknown) =>
    setIt((s) => {
      const c = { ...s.config };
      if (v === undefined || v === null || v === "") delete c[k];
      else c[k] = v;
      return { ...s, config: c };
    });
  const str = (k: string) => (typeof cfg[k] === "string" ? (cfg[k] as string) : "");
  const num = (k: string) => (typeof cfg[k] === "number" ? (cfg[k] as number) : 0);

  const field = (label: string, el: ReactNode) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-32 shrink-0 text-zinc-500">{label}</span>
      {el}
    </label>
  );
  const sel = (k: string, opts: [string, string][]) =>
    field(
      label4(k),
      <select value={str(k)} onChange={(e) => setCfg(k, e.target.value)} className={input}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>,
    );
  const label4 = (k: string) =>
    ({ transition: "Transition", seconds: "Auto-advance", presentation: "Verse order", print: "Print flag", resize: "Resize", keepAspect: "Keep aspect", action: "Action" })[k] ?? k;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">
          Edit item — {it.title || it.kind}
        </h2>
        <div className="space-y-2">
          {field(
            "Name",
            <input value={it.title} onChange={(e) => setIt((s) => ({ ...s, title: e.target.value }))} className={`${input} flex-1`} />,
          )}
          {field(
            "Notes",
            <input
              value={it.notes ?? ""}
              onChange={(e) => setIt((s) => ({ ...s, notes: e.target.value === "" ? null : e.target.value }))}
              className={`${input} flex-1`}
            />,
          )}
          {it.kind === "song" && (
            <>
              {songKey !== undefined && songKey !== null && songKey !== "" && (
                <p className="text-xs text-zinc-500">
                  Song key: <b>{songKey}</b>
                  {num("transpose") !== 0 && ` → ${transposeKey(songKey, num("transpose"))}`}
                </p>
              )}
              {field(
                "Transpose",
                <select value={num("transpose")} onChange={(e) => setCfg("transpose", Number(e.target.value) === 0 ? undefined : Number(e.target.value))} className={input}>
                  {Array.from({ length: 23 }, (_, i) => i - 11).map((n) => (
                    <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>
                  ))}
                </select>,
              )}
            </>
          )}
          {it.kind === "song" &&
            field(
              "Verse order",
              <input
                value={str("presentation")}
                onChange={(e) => setCfg("presentation", e.target.value)}
                placeholder="e.g. V1 C V2 C (blank = song default)"
                className={`${input} flex-1`}
              />,
            )}
          {it.kind === "style" &&
            sel("action", [
              ["", "Style change (push)"],
              ["revert", "Style revert (pop)"],
            ])}
          {it.kind === "media" && (
            <>
              {sel("resize", [
                ["", "Default (settings)"],
                ["screen", "Fit screen"],
                ["body", "Fit body area"],
                ["default", "No resize"],
              ])}
              {sel("keepAspect", [
                ["", "Default (settings)"],
                ["true", "Keep aspect"],
                ["false", "Stretch"],
              ])}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={str("descriptionsInSubtitle") === "true"}
                  onChange={(e) => setCfg("descriptionsInSubtitle", e.target.checked ? "true" : undefined)}
                />
                Descriptions in subtitle
              </label>
            </>
          )}
          {it.kind !== "style" && (
            <>
              {field(
                "Auto-advance (s)",
                <input
                  type="number"
                  min={0}
                  value={num("seconds")}
                  onChange={(e) => setCfg("seconds", Number(e.target.value) > 0 ? Number(e.target.value) : undefined)}
                  className={input}
                />,
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={str("loop") === "true"}
                  onChange={(e) => setCfg("loop", e.target.checked ? "true" : undefined)}
                />
                Loop slides
              </label>
              {sel("transition", [
                ["", "Default"],
                ["1", "Force on"],
                ["2", "Force off"],
              ])}
              {sel("print", [
                ["", "Default"],
                ["yes", "Print"],
                ["no", "Don't print"],
              ])}
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={dlgBtn}>Cancel</button>
          <button onClick={() => { onSave(it); onClose(); }} className={`${dlgBtn} bg-indigo-600 text-white hover:bg-indigo-500`}>Save</button>
        </div>
      </div>
    </div>
  );
}

/** Shift a note name by semitones within the sharp/flat key lists. */
function transposeKey(key: string, semi: number): string {
  const i = KEYS.indexOf(key.trim());
  if (i === -1) return key;
  const flat = key.includes("b");
  const idx = (((i + semi) % 12) + 12) % 12;
  const sharpKeys = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const flatKeys = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  return (flat ? flatKeys : sharpKeys)[idx]!;
}
