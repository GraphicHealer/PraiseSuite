import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  defaultSlideStyle,
  type ServiceItem,
  type SlideStyleOverride,
} from "@praisesuite/core";
import type { SlideStyle } from "../slide-types.js";
import { api } from "../api.js";
import { StyleEditor } from "./StyleEditor.js";
import { useDialog } from "./Dialog.js";

const input =
  "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const dlgBtn =
  "rounded border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";
const miniBtn =
  "rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";

const KEYS = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];

/** One image in a media item's slide list (OpenSong <slides><image>). */
type Img = {
  storageKey?: string | undefined;
  filename?: string | undefined;
  description?: string | undefined;
};

/** SlideStyle -> the SlideStyleOverride subset a set's <style> element stores. */
const toOverride = (s: SlideStyle): SlideStyleOverride => ({
  title: s.title,
  body: s.body,
  subtitle: s.subtitle,
  backgroundColor: s.backgroundColor,
  backgroundKey: s.backgroundKey,
  margin: s.margin,
  descriptiveSubtitles: s.descriptiveSubtitles,
  highlightChorus: s.highlightChorus,
  songSubtitle: s.songSubtitle,
  backgroundFit: s.backgroundFit,
  backgroundStripFooter: s.backgroundStripFooter,
  ...(s.backgroundPosX !== undefined ? { backgroundPosX: s.backgroundPosX } : {}),
  ...(s.backgroundPosY !== undefined ? { backgroundPosY: s.backgroundPosY } : {}),
  ...(s.bodyTabs !== undefined ? { bodyTabs: s.bodyTabs } : {}),
});

const fileToB64 = async (f: File): Promise<string> => {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
};

/**
 * Per-item editor (OpenSong's item-edit panels as a dialog): shared fields
 * (name/subtitle/notes, @presentation/@print/@transition/@seconds/@loop)
 * plus per-kind panels — song transpose, style-change action + style
 * picker/editor, and the media item's image list (add/remove/reorder).
 */
export function ItemEditor({
  item,
  songKey,
  globalStyle,
  onSave,
  onClose,
}: {
  item: ServiceItem;
  /** Resolved key of the linked song (for the transpose hint), if any. */
  songKey?: string | null | undefined;
  /** Global slide style — base for the style item's embedded editor. */
  globalStyle?: SlideStyle | null | undefined;
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

  /* ── Style item: preset loader + embedded style editor ─────────── */

  // Named styles to load into the item: OpenSong's two built-ins, then
  // every library song's own <style> (OpenSong keeps them per-song).
  const [choices, setChoices] = useState<{ group: string; name: string; style: SlideStyle }[]>([]);
  // "" = untouched; "custom" = the item's own (hand-edited) style; a number
  // = index into `choices`. The item's own style preselects Custom.
  const [chosen, setChosen] = useState(() => (item.config["style"] !== undefined ? "custom" : ""));
  const [editStyle, setEditStyle] = useState(false);
  const dlg = useDialog();
  const loadChoices = () =>
    api
      .stylesList()
      .then((r) =>
        setChoices([
          ...r.presets.map((p) => ({ group: "Styles", name: p.name, style: p.style })),
          ...r.saved.map((s) => ({ group: "Saved styles", name: s.name, style: s.style })),
          ...r.songs.map((s) => ({ group: "Song styles", name: s.title, style: s.style })),
        ]),
      )
      .catch(() => {});
  useEffect(() => {
    if (item.kind !== "style") return;
    void loadChoices();
  }, [item.kind]);
  /** "Save As…" in the embedded StyleEditor: name it into the style library,
   *  then select it in the dropdown by name. */
  const saveStyleAs = async (s: SlideStyle) => {
    const name = (await dlg.prompt("Name this style:", ""))?.trim();
    if (!name) return;
    try {
      await api.saveNamedStyle(name, s);
    } catch {
      return;
    }
    setCfg("style", toOverride(s));
    setEditStyle(false);
    void api
      .stylesList()
      .then((r) => {
        const next = [
          ...r.presets.map((p) => ({ group: "Styles", name: p.name, style: p.style })),
          ...r.saved.map((x) => ({ group: "Saved styles", name: x.name, style: x.style })),
          ...r.songs.map((x) => ({ group: "Song styles", name: x.title, style: x.style })),
        ];
        setChoices(next);
        const i = next.findIndex((c) => c.group === "Saved styles" && c.name === name);
        setChosen(i >= 0 ? String(i) : "custom");
      })
      .catch(() => setChosen("custom"));
  };

  const baseStyle = globalStyle ?? defaultSlideStyle();
  const curOverride = cfg["style"] as SlideStyleOverride | undefined;
  const mergedStyle: SlideStyle = {
    ...baseStyle,
    ...(curOverride ?? {}),
    title: { ...baseStyle.title, ...(curOverride?.title ?? {}) },
    body: { ...baseStyle.body, ...(curOverride?.body ?? {}) },
    subtitle: { ...baseStyle.subtitle, ...(curOverride?.subtitle ?? {}) },
  };

  /* ── Media item: image list editor ─────────────────────────────── */

  const imgList = (): Img[] => {
    const imgs = cfg["images"];
    if (Array.isArray(imgs)) return imgs as Img[];
    const keys = cfg["assetKeys"];
    if (Array.isArray(keys))
      return keys.filter((k): k is string => typeof k === "string").map((k) => ({ storageKey: k }));
    return [];
  };
  const setImages = (list: Img[]) =>
    setIt((s) => {
      const c = { ...s.config };
      delete c["assetKeys"];
      if (list.length === 0) delete c["images"];
      else c["images"] = list;
      return { ...s, config: c };
    });
  const imgs = imgList();
  const moveImg = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= imgs.length) return;
    const next = [...imgs];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setImages(next);
  };

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [library, setLibrary] = useState<{ storageKey: string; originalFilename: string | null }[]>([]);
  useEffect(() => {
    if (item.kind !== "media") return;
    void api
      .mediaList()
      .then((l) => setLibrary(l.filter((m) => m.mediaType.startsWith("image/"))))
      .catch(() => {});
  }, [item.kind]);

  const addFile = async (f: File) => {
    const r = await api.uploadMedia(f.name, f.type || "image/jpeg", await fileToB64(f));
    setImages([...imgList(), { storageKey: r.storageKey, filename: f.name }]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
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
          {it.kind === "media" &&
            field(
              "Subtitle",
              <input
                value={it.subtitle ?? ""}
                onChange={(e) => setIt((s) => ({ ...s, subtitle: e.target.value === "" ? null : e.target.value }))}
                className={`${input} flex-1`}
              />,
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
          {it.kind === "style" && (
            <>
              {/* OpenSong style_change editor: action radio + style canvas */}
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={str("action") !== "revert"}
                    onChange={() => setCfg("action", undefined)}
                  />
                  Change Style to the Following:
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={str("action") === "revert"}
                    onChange={() => setCfg("action", "revert")}
                  />
                  Revert to Previous Style
                </label>
              </div>
              {str("action") !== "revert" && (
                <>
                  {field(
                    "Style",
                    <select
                      value={chosen}
                      onChange={(e) => {
                        const v = e.target.value;
                        setChosen(v);
                        if (v !== "custom" && v !== "") {
                          const c = choices[Number(v)];
                          if (c) setCfg("style", toOverride(c.style));
                        }
                      }}
                      className={`${input} flex-1`}
                    >
                      <option value="">Choose a style…</option>
                      {cfg["style"] !== undefined && <option value="custom">Custom</option>}
                      {["Styles", "Saved styles", "Song styles"].map((g) => (
                        <optgroup key={g} label={g}>
                          {choices.map((c, i) =>
                            c.group === g ? <option key={i} value={i}>{c.name}</option> : null,
                          )}
                        </optgroup>
                      ))}
                    </select>,
                  )}
                  <button onClick={() => setEditStyle(true)} className={dlgBtn}>
                    Edit style…
                  </button>
                </>
              )}
            </>
          )}
          {it.kind === "media" && (
            <>
              {/* OpenSong image page: image list w/ insert/delete/reorder */}
              <div className="text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-zinc-500">Images</span>
                  <span className="flex gap-1">
                    <button onClick={() => fileRef.current?.click()} className={miniBtn}>
                      Add…
                    </button>
                    {library.length > 0 && (
                      <select
                        value=""
                        className={`${input} !py-0.5 text-xs`}
                        onChange={(e) => {
                          const m = library[Number(e.target.value)];
                          if (m) setImages([...imgList(), { storageKey: m.storageKey, filename: m.originalFilename ?? undefined }]);
                        }}
                      >
                        <option value="">Library…</option>
                        {library.map((m, i) => (
                          <option key={m.storageKey} value={i}>{m.originalFilename ?? m.storageKey}</option>
                        ))}
                      </select>
                    )}
                  </span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    for (const f of list) void addFile(f);
                  }}
                />
                <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
                  {imgs.map((img, i) => (
                    <li key={i} className="flex items-center gap-1 px-2 py-1">
                      <span className="min-w-0 flex-1 truncate">{img.filename ?? img.storageKey ?? "image"}</span>
                      <input
                        value={img.description ?? ""}
                        placeholder="description"
                        onChange={(e) => {
                          const next = [...imgs];
                          next[i] = { ...img, description: e.target.value === "" ? undefined : e.target.value };
                          setImages(next);
                        }}
                        className={`${input} !py-0.5 w-32 text-xs`}
                      />
                      <button disabled={i === 0} onClick={() => moveImg(i, -1)} className={miniBtn} title="Move up">↑</button>
                      <button disabled={i === imgs.length - 1} onClick={() => moveImg(i, 1)} className={miniBtn} title="Move down">↓</button>
                      <button onClick={() => setImages(imgs.filter((_, j) => j !== i))} className={`${miniBtn} text-red-600`} title="Remove">✕</button>
                    </li>
                  ))}
                  {imgs.length === 0 && (
                    <li className="px-2 py-3 text-center text-xs text-zinc-500">No images — add one.</li>
                  )}
                </ul>
              </div>
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

      {/* OpenSong SStyleCanvas click → StyleWindow.Edit on the item's <style>. */}
      {editStyle && (
        <StyleEditor
          style={mergedStyle}
          heading={`Style Editor — ${it.title || "Item"}`}
          onClose={() => setEditStyle(false)}
          onSave={(s) => {
            setCfg("style", toOverride(s));
            setChosen("custom");
            setEditStyle(false);
          }}
          onSaveAs={(s) => void saveStyleAs(s)}
        />
      )}
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
