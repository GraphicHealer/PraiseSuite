import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api.js";
import { BUNDLED_FONTS } from "../fonts.js";
import { SlideCanvas } from "./SlideCanvas.js";
import type { SlideStyle, StyleTab, TextStyle } from "../slide-types.js";

/**
 * OpenSong StyleWindow parity: the dialog opened by every SStyleCanvas
 * (default style, scripture style, song Override Style, set-item style).
 * Edits a complete SlideStyle; callers decide how to persist it.
 */

type Role = "title" | "subtitle" | "body";

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800";
const btn =
  "rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";

/** OpenSong's background position popup (image_fit): Cover/Contain/Fill/None/Center. */
const FITS: { value: SlideStyle["backgroundFit"]; label: string }[] = [
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "fill", label: "Fill" },
  { value: "center", label: "Center" },
];

/** OpenSong SubtitleList rows (style_editor/subtitles in the language file). */
const SUBTITLE_FIELDS: { key: string; label: string }[] = [
  { key: "copyright", label: "Copyright" },
  { key: "author", label: "Author" },
  { key: "hymn_number", label: "Hymn Number" },
  { key: "ccli_number", label: "CCLI Song Number" },
  { key: "ccli_license", label: "CCLI License Number" },
];

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }): ReactNode {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] overflow-y-auto rounded-lg bg-white p-4 shadow-2xl dark:bg-zinc-900 ${wide ? "w-[46rem]" : "w-[36rem]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** OpenSong's 9-way align canvas (SAlignCanvas): valign rows × align cols. */
function AlignPicker({ value, onChange }: { value: TextStyle; onChange: (t: TextStyle) => void }): ReactNode {
  const vrows: TextStyle["valign"][] = ["top", "middle", "bottom"];
  const acols: TextStyle["align"][] = ["left", "center", "right"];
  return (
    <div className="inline-grid grid-cols-3 overflow-hidden rounded border border-zinc-400 dark:border-zinc-600" title="Alignment (vertical × horizontal)">
      {vrows.map((v) =>
        acols.map((a) => (
          <button
            key={`${v}-${a}`}
            type="button"
            className={`h-4 w-4 border border-zinc-200 dark:border-zinc-700 ${
              value.valign === v && value.align === a ? "bg-indigo-500" : "bg-white hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-600"
            }`}
            onClick={() => onChange({ ...value, valign: v, align: a })}
          />
        )),
      )}
    </div>
  );
}

/** Color swatch — OpenSong SColorCanvas (click to change). */
function Swatch({ color, onChange }: { color: string; onChange: (c: string) => void }): ReactNode {
  return (
    <label className="relative inline-block h-6 w-10 cursor-pointer overflow-hidden rounded border border-zinc-400 dark:border-zinc-600" title="Click to change">
      <span className="absolute inset-0" style={{ backgroundColor: color }} />
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}/.test(color) ? color.slice(0, 7) : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

/** SFontCanvas: a swatch summarizing the font — opens the font dialog. */
function FontSwatch({ t, onClick }: { t: TextStyle; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-44 items-center justify-center rounded border border-zinc-400 text-xs hover:ring-1 hover:ring-indigo-400 dark:border-zinc-600"
      style={{
        fontFamily: t.font,
        fontWeight: t.bold ? "bold" : "normal",
        fontStyle: t.italic ? "italic" : "normal",
        textDecoration: t.underline ? "underline" : "none",
        color: t.color,
        backgroundColor: "#1a1a1a",
        textShadow: t.border ? "0 0 2px #000" : "none",
      }}
      title={`${t.font} ${t.size}pt — click to change`}
    >
      {t.font} {t.size}
    </button>
  );
}

/** OpenSong's font dialog — every TextStyle attribute. */
function FontDialog({ value, onSave, onClose }: { value: TextStyle; onSave: (t: TextStyle) => void; onClose: () => void }): ReactNode {
  const [t, setT] = useState<TextStyle>({ ...value });
  const set = <K extends keyof TextStyle>(k: K, v: TextStyle[K]) => setT((x) => ({ ...x, [k]: v }));
  const chk = (k: "bold" | "italic" | "underline" | "border" | "shadow" | "fill", label: string) => (
    <label className="flex items-center gap-1.5 text-sm">
      <input type="checkbox" checked={t[k]} onChange={(e) => set(k, e.target.checked)} />
      {label}
    </label>
  );
  return (
    <Modal title="Font" onClose={onClose}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          Font
          <select className={`${input} flex-1`} value={t.font} onChange={(e) => set("font", e.target.value)}>
            {BUNDLED_FONTS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
            {!BUNDLED_FONTS.includes(t.font as (typeof BUNDLED_FONTS)[number]) && <option value={t.font}>{t.font}</option>}
          </select>
          <input
            type="number"
            className={`${input} w-20`}
            value={t.size}
            onChange={(e) => set("size", Number(e.target.value))}
            title="Size (pt)"
          />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          {chk("bold", "Bold")}
          {chk("italic", "Italic")}
          {chk("underline", "Underline")}
          <label className="flex items-center gap-2 text-sm">
            Color <Swatch color={t.color} onChange={(c) => set("color", c)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {chk("border", "Border")}
          {t.border && (
            <label className="flex items-center gap-2 text-sm">
              Border color <Swatch color={t.borderColor} onChange={(c) => set("borderColor", c)} />
            </label>
          )}
          {chk("shadow", "Shadow")}
          {t.shadow && (
            <label className="flex items-center gap-2 text-sm">
              Shadow color <Swatch color={t.shadowColor} onChange={(c) => set("shadowColor", c)} />
            </label>
          )}
          {chk("fill", "Fill")}
          {t.fill && (
            <label className="flex items-center gap-2 text-sm">
              Fill color <Swatch color={t.fillColor} onChange={(c) => set("fillColor", c)} />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className={btn} onClick={onClose}>Cancel</button>
          <button className="rounded bg-indigo-600 px-4 py-1 text-sm text-white hover:bg-indigo-500" onClick={() => onSave(t)}>OK</button>
        </div>
      </div>
    </Modal>
  );
}

/** StyleMarginWindow: per-element margins in 640-unit px. */
function MarginsDialog({ label, value, onSave, onClose }: { label: string; value: TextStyle; onSave: (t: TextStyle) => void; onClose: () => void }): ReactNode {
  const [t, setT] = useState<TextStyle>({ ...value });
  const field = (k: "marginLeft" | "marginRight" | "marginTop" | "marginBottom", label: string) => (
    <label className="flex items-center gap-2 text-sm capitalize">
      {label}
      <input
        type="number"
        className={`${input} w-20`}
        value={t[k] ?? 0}
        onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })}
      />
      <span className="text-zinc-500">px</span>
    </label>
  );
  return (
    <Modal title={`Margins — ${label}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {field("marginLeft", "left")}
        {field("marginRight", "right")}
        {field("marginTop", "top")}
        {field("marginBottom", "bottom")}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className="rounded bg-indigo-600 px-4 py-1 text-sm text-white hover:bg-indigo-500" onClick={() => onSave(t)}>OK</button>
      </div>
    </Modal>
  );
}

/** StyleTabsWindow: tab stop list + per-stop properties. */
function TabsDialog({ tabs, onSave, onClose }: { tabs: StyleTab[]; onSave: (t: StyleTab[]) => void; onClose: () => void }): ReactNode {
  const [list, setList] = useState<StyleTab[]>(tabs.map((t) => ({ ...t })));
  const [sel, setSel] = useState<number | null>(list.length > 0 ? 0 : null);
  const cur = sel !== null ? list[sel] : null;
  const patch = (p: Partial<StyleTab>) =>
    setList((l) => (sel === null ? l : l.map((t, i) => (i === sel ? { ...t, ...p } : t))));
  return (
    <Modal title="Tabulators" onClose={onClose} wide>
      <div className="flex gap-3">
        <div className="w-40 shrink-0">
          <div className="mb-2 max-h-48 overflow-y-auto rounded border border-zinc-300 dark:border-zinc-700">
            {list.map((t, i) => (
              <button
                key={i}
                className={`block w-full px-2 py-1 text-left text-sm ${sel === i ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                onClick={() => setSel(i)}
              >
                {t.position} — {t.align}{t.align === "char" && t.char !== undefined ? ` "${t.char}"` : ""}
              </button>
            ))}
            {list.length === 0 && <div className="px-2 py-3 text-center text-xs text-zinc-500">(none)</div>}
          </div>
          <div className="flex flex-col gap-1">
            <button className={btn} onClick={() => { setList((l) => [...l, { position: 320, align: "left" }]); setSel(list.length); }}>New</button>
            <button className={btn} disabled={sel === null} onClick={() => { setList((l) => l.filter((_, i) => i !== sel)); setSel(null); }}>Remove</button>
            <button className={btn} disabled={list.length === 0} onClick={() => { setList([]); setSel(null); }}>Remove All</button>
          </div>
        </div>
        <fieldset className="flex-1 rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <legend className="px-1 text-sm font-medium">Properties</legend>
          {cur === null || cur === undefined ? (
            <p className="text-sm text-zinc-500">Select a tab stop.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                Position
                <input type="number" className={`${input} w-24`} value={cur.position} onChange={(e) => patch({ position: Number(e.target.value) })} />
                px
              </label>
              <div className="flex flex-col gap-1">
                {(["left", "center", "right", "char"] as const).map((a) => (
                  <label key={a} className="flex items-center gap-2">
                    <input type="radio" name="tabalign" checked={cur.align === a} onChange={() => patch({ align: a })} />
                    {a === "char" ? "At character" : a[0]!.toUpperCase() + a.slice(1)}
                  </label>
                ))}
                {cur.align === "char" && (
                  <input className={`${input} ml-6 w-16`} maxLength={1} value={cur.char ?? "."} onChange={(e) => patch({ char: e.target.value || "." })} />
                )}
              </div>
            </div>
          )}
        </fieldset>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button className={btn} onClick={onClose}>Cancel</button>
        <button
          className="rounded bg-indigo-600 px-4 py-1 text-sm text-white hover:bg-indigo-500"
          onClick={() => onSave(list.filter((t) => t.position > 0).sort((a, b) => a.position - b.position))}
        >
          OK
        </button>
      </div>
    </Modal>
  );
}

/** Background image picker — media library (bundled defaults + uploads). */
function ImagePicker({ onPick, onClose }: { onPick: (key: string | null) => void; onClose: () => void }): ReactNode {
  const [media, setMedia] = useState<{ storageKey: string; mediaType: string; originalFilename: string | null }[]>([]);
  useEffect(() => void api.mediaList().then((m) => setMedia(m.filter((x) => x.mediaType.startsWith("image/")))).catch(() => {}), []);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
      await api.uploadMedia(f.name, f.type || "image/jpeg", btoa(bin));
    }
    setMedia((await api.mediaList()).filter((x) => x.mediaType.startsWith("image/")));
  };
  return (
    <Modal title="Background image" onClose={onClose} wide>
      <div className="mb-3 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto">
        {media.map((m) => (
          <button
            key={m.storageKey}
            className="group rounded border border-zinc-300 p-1 hover:border-indigo-400 dark:border-zinc-700"
            onClick={() => onPick(m.storageKey)}
            title={m.originalFilename ?? m.storageKey}
          >
            <img src={`/api/v1/media/${encodeURIComponent(m.storageKey.split("/").pop()!)}`} className="h-20 w-full rounded object-cover" alt="" />
            <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{m.originalFilename ?? m.storageKey}</span>
          </button>
        ))}
        {media.length === 0 && <p className="col-span-4 py-6 text-center text-sm text-zinc-500">No images — upload one or apply the OpenSong defaults.</p>}
      </div>
      <div className="flex items-center justify-between">
        <label className={`${btn} cursor-pointer`}>
          Upload…
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
        </label>
        <div className="flex gap-2">
          <button className={btn} onClick={() => onPick(null)}>Clear image</button>
          <button className={btn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

/** One StyleWindow row: [Show X][font canvas][9-way align][Margins…]. */
function RoleRow({
  role,
  label,
  t,
  onChange,
  onFont,
  onMargins,
  onTabs,
}: {
  role: Role;
  label: string;
  t: TextStyle;
  onChange: (t: TextStyle) => void;
  onFont: () => void;
  onMargins: () => void;
  onTabs?: (() => void) | undefined;
}): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <label className="flex w-28 items-center gap-1.5 text-sm">
        <input type="checkbox" checked={t.enabled} onChange={(e) => onChange({ ...t, enabled: e.target.checked })} />
        Show {label}:
      </label>
      <FontSwatch t={t} onClick={onFont} />
      <AlignPicker value={t} onChange={onChange} />
      <button className={btn} onClick={onMargins}>Margins…</button>
      {role === "body" && (
        <>
          <button className={btn} onClick={onTabs}>Tabulators…</button>
          <label className="flex items-center gap-1.5 text-xs" title="Automatic font size scaling to make text fit">
            <input type="checkbox" checked={t.autoScale} onChange={(e) => onChange({ ...t, autoScale: e.target.checked })} />
            Auto-scale
          </label>
        </>
      )}
    </div>
  );
}

export function StyleEditor({
  style,
  heading = "Style Editor",
  onSave,
  onClose,
}: {
  style: SlideStyle;
  heading?: string;
  onSave: (s: SlideStyle) => void;
  onClose: () => void;
}): ReactNode {
  const [s, setS] = useState<SlideStyle>(() => JSON.parse(JSON.stringify(style)) as SlideStyle);
  const [sub, setSub] = useState<`font:${Role}` | `margins:${Role}` | "tabs" | "image" | null>(null);
  const setRole = (r: Role) => (t: TextStyle) => setS((x) => ({ ...x, [r]: t }));

  // song_subtitle: checked keys in stored order, then unchecked in canonical order.
  const subChecked = new Set(s.songSubtitle);
  const subRows = [...SUBTITLE_FIELDS].sort(
    (a, b) =>
      (subChecked.has(b.key) ? 1 : 0) - (subChecked.has(a.key) ? 1 : 0) ||
      (subChecked.has(a.key) ? s.songSubtitle.indexOf(a.key) : SUBTITLE_FIELDS.indexOf(a)) -
        (subChecked.has(b.key) ? s.songSubtitle.indexOf(b.key) : SUBTITLE_FIELDS.indexOf(b)),
  );
  const toggleSub = (key: string) =>
    setS((x) => ({
      ...x,
      songSubtitle: subChecked.has(key)
        ? x.songSubtitle.filter((k) => k !== key)
        : [...x.songSubtitle, key],
    }));

  return (
    <Modal title={heading} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {/* Live preview (SStyleCanvas / StyleMarginWindow preview spirit) */}
        <div className="mx-auto aspect-video w-72 overflow-hidden rounded border border-zinc-400 dark:border-zinc-600">
          <SlideCanvas
            title="Sample Title"
            subtitle="Sample Subtitle"
            lines={["Sample body line one", "Sample body line two"]}
            style={s}
            backgroundKey={s.backgroundKey}
          />
        </div>

        {/* grp_style_fonts_and_alignment */}
        <fieldset className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <legend className="px-1 font-medium">Style Editor</legend>
          <div className="space-y-2">
            <RoleRow role="title" label="Title" t={s.title} onChange={setRole("title")} onFont={() => setSub("font:title")} onMargins={() => setSub("margins:title")} />
            <RoleRow role="subtitle" label="Subtitle" t={s.subtitle} onChange={setRole("subtitle")} onFont={() => setSub("font:subtitle")} onMargins={() => setSub("margins:subtitle")} />
            <RoleRow role="body" label="Body" t={s.body} onChange={setRole("body")} onFont={() => setSub("font:body")} onMargins={() => setSub("margins:body")} onTabs={() => setSub("tabs")} />
          </div>
        </fieldset>

        {/* grp_style_background */}
        <fieldset className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <legend className="px-1 font-medium">Background</legend>
          <div className="flex flex-wrap items-center gap-3">
            <span>Color</span>
            <Swatch color={s.backgroundColor} onChange={(c) => setS({ ...s, backgroundColor: c })} />
            <span className="ml-2">Image</span>
            <button
              className="h-8 w-14 overflow-hidden rounded border border-zinc-400 dark:border-zinc-600"
              onClick={() => setSub("image")}
              title={s.backgroundKey ?? "Click to change"}
            >
              {s.backgroundKey !== null && s.backgroundKey !== undefined && s.backgroundKey !== "" ? (
                <img src={`/api/v1/media/${encodeURIComponent(s.backgroundKey.split("/").pop()!)}`} className="h-full w-full object-cover" alt="" />
              ) : (
                <span className="text-[10px] text-zinc-400">none</span>
              )}
            </button>
            {s.backgroundKey !== null && s.backgroundKey !== "" && (
              <button className={btn} onClick={() => setS({ ...s, backgroundKey: null })}>Clear</button>
            )}
            <label className="ml-2 flex items-center gap-2">
              Position
              <select className={input} value={s.backgroundFit} onChange={(e) => setS({ ...s, backgroundFit: e.target.value as SlideStyle["backgroundFit"] })}>
                {FITS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2" title="Pixels trimmed off the image bottom (footer strip)">
              Trim bottom
              <input type="number" className={`${input} w-20`} value={s.backgroundStripFooter} onChange={(e) => setS({ ...s, backgroundStripFooter: Number(e.target.value) })} />
              px
            </label>
          </div>
        </fieldset>

        {/* grp_style_options */}
        <fieldset className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <legend className="px-1 font-medium">Textual options</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.descriptiveSubtitles} onChange={(e) => setS({ ...s, descriptiveSubtitles: e.target.checked })} />
              Include descriptive text on subtitles
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.highlightChorus} onChange={(e) => setS({ ...s, highlightChorus: e.target.checked })} />
              Highlight choruses
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.title.includeVerse === true} onChange={(e) => setS({ ...s, title: { ...s.title, includeVerse: e.target.checked } })} />
              Include verse numbers in title
            </label>
          </div>
          <div className="mt-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Song subtitles</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {subRows.map((f) => (
                <label key={f.key} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={subChecked.has(f.key)} onChange={() => toggleSub(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {/* grp_style_bilingual */}
        <fieldset className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <legend className="px-1 font-medium">Bilingual presentation</legend>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              Second language color
              <Swatch color={s.body.multilanguageColor ?? "#DCDCDC"} onChange={(c) => setS({ ...s, body: { ...s.body, multilanguageColor: c } })} />
            </label>
            <label className="flex items-center gap-2">
              Font size
              <input
                type="number"
                className={`${input} w-20`}
                value={s.body.multilanguageSize ?? 70}
                onChange={(e) => setS({ ...s, body: { ...s.body, multilanguageSize: Number(e.target.value) } })}
              />
              %
            </label>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button className={btn} onClick={onClose}>Cancel</button>
          <button className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-500" onClick={() => onSave(s)}>OK</button>
        </div>
      </div>

      {sub === "font:title" && <FontDialog value={s.title} onClose={() => setSub(null)} onSave={(t) => { setS({ ...s, title: t }); setSub(null); }} />}
      {sub === "font:subtitle" && <FontDialog value={s.subtitle} onClose={() => setSub(null)} onSave={(t) => { setS({ ...s, subtitle: t }); setSub(null); }} />}
      {sub === "font:body" && <FontDialog value={s.body} onClose={() => setSub(null)} onSave={(t) => { setS({ ...s, body: t }); setSub(null); }} />}
      {sub === "margins:title" && <MarginsDialog label="Title" value={s.title} onClose={() => setSub(null)} onSave={(t) => { setS({ ...s, title: t }); setSub(null); }} />}
      {sub === "margins:subtitle" && <MarginsDialog label="Subtitle" value={s.subtitle} onClose={() => setSub(null)} onSave={(t) => { setS({ ...s, subtitle: t }); setSub(null); }} />}
      {sub === "margins:body" && <MarginsDialog label="Body" value={s.body} onClose={() => setSub(null)} onSave={(t) => { setS({ ...s, body: t }); setSub(null); }} />}
      {sub === "tabs" && <TabsDialog tabs={s.bodyTabs ?? []} onClose={() => setSub(null)} onSave={(t) => { setS({ ...s, bodyTabs: t }); setSub(null); }} />}
      {sub === "image" && <ImagePicker onClose={() => setSub(null)} onPick={(k) => { setS({ ...s, backgroundKey: k }); setSub(null); }} />}
    </Modal>
  );
}
