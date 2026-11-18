import { useEffect, useRef, useState, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import {
  parseOpenSongLyrics,
  serializeOpenSongLyrics,
  transposeSourceText,
  type Song,
  type SongArrangement,
  type SongBackgrounds,
  type SongSectionId,
  type ArrangementSectionId,
} from "@praisesuite/core";
import { api } from "../api.js";
import { useDialog } from "../components/Dialog.js";
import { opensongLanguage } from "../opensong-language.js";
import { useDark } from "../use-dark.js";
import { openPrintPreview } from "../PrintPreview.js";

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800";
const btn =
  "rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

function Field({ label, value, onChange, className }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}): ReactNode {
  return (
    <label className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <span className="text-xs text-zinc-500">{label}</span>
      <input className={input} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Arrangement[0] presentation order -> "V1 C V2 C" label string. */
function presentationOf(song: Song): string {
  const seq = song.arrangements[0]?.sequence ?? [];
  return seq
    .map((as) => {
      const label = song.sections.find((s) => s.id === as.sectionId)?.label ?? "?";
      const ref = `${label}${as.prefix ?? ""}`;
      return as.repeats > 1 ? `${ref} x${as.repeats}` : ref;
    })
    .join(" ");
}

/**
 * OpenSong-style song editor: metadata fields + a monospaced Chord/Lyrics
 * source box edited in raw notation ([V1], .chord lines, | breaks, ;comments),
 * with Insert helpers and General/Advanced tabs (MainWindow parity).
 */
export function SongEditorPage({ id, onBack, onPresent, onCopied }: {
  id: string;
  /** Optional — embedded in the main window (OpenSong-style) when provided along with the other callbacks; standalone page otherwise. */
  onBack?: () => void;
  onPresent?: (song: Song) => void;
  onCopied?: (id: string) => void;
}): ReactNode {
  const dlg = useDialog();
  const [song, setSong] = useState<Song | null>(null);
  const [tab, setTab] = useState<"general" | "advanced" | "backgrounds">("general");
  const [source, setSource] = useState("");
  const [presentation, setPresentation] = useState("");
  const [capo, setCapo] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  // Print buttons open the standalone preview window (Chrome-style popup).
  const setPrintUrl = (url: string | null) => {
    if (url !== null) openPrintPreview({ url, filename: `${song?.title ?? "song"}.pdf`, logUrl: api.printUrl(`/api/v1/songs/${encodeURIComponent(id)}/log?action=6`) });
  };
  const [userLabels, setUserLabels] = useState<string[]>([]);
  const viewRef = useRef<EditorView | null>(null);
  const dark = useDark();

  const reload = () =>
    api.song(id).then((s) => {
      setSong(s);
      setSource(serializeOpenSongLyrics(s));
      setPresentation(presentationOf(s));
      setCapo(s.arrangements[0]?.capo?.toString() ?? "");
      setDirty(false);
      setStatus("");
    });

  useEffect(() => {
    void reload();
    api.style().then((s) => setUserLabels(s.userFieldLabels ?? []));
  }, [id]);

  const update = (patch: Partial<Song>) => {
    setSong((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };

  /** OpenSong style/@blank_is_slide_change, honored by the lyric parser. */
  const [blankIsSlideChange, setBlankIsSlideChange] = useState(false);
  useEffect(() => {
    api
      .setting<{ blankIsSlideChange?: boolean }>("style.options")
      .then((r) => setBlankIsSlideChange(r.value?.blankIsSlideChange === true))
      .catch(() => {});
  }, []);

  /** Rebuild sections from source text, preserving section ids by label. */
  const applySource = (base: Song, text: string = source): Song | null => {
    const { sections: parsed, warnings } = parseOpenSongLyrics(text, { blankIsSlideChange });
    const byLabel = new Map(base.sections.map((s) => [s.label, s.id]));
    const used = new Set<string>();
    const sections = parsed.map((s) => {
      let sid = byLabel.get(s.label);
      if (sid && used.has(sid)) sid = undefined;
      if (!sid) sid = crypto.randomUUID() as SongSectionId;
      used.add(sid);
      return { ...s, id: sid };
    });
    const valid = new Set(sections.map((s) => s.id));
    const arrangements = base.arrangements.map((a) => ({
      ...a,
      sequence: a.sequence.filter((as) => valid.has(as.sectionId)),
    }));
    const next = { ...base, sections, arrangements };
    setSong(next);
    setStatus(warnings.length ? `Parsed with ${warnings.length} warning(s)` : "");
    return next;
  };

  /** Fold the Presentation-order string into arrangement[0].sequence. */
  const applyPresentation = (base: Song): Song => {
    const labels = presentation.trim().split(/\s+/).filter(Boolean);
    const capoNum = capo.trim() === "" ? null : Number.parseInt(capo, 10);
    const pool = base.sections.map((s) => ({ label: s.label, sectionId: s.id }));
    const sequence = labels
      .map((tok) => {
        const m = /^(.+?)\s*x(\d+)$/i.exec(tok);
        const ref = m ? m[1]! : tok;
        const repeats = m ? Number.parseInt(m[2]!, 10) : 1;
        // "C" -> section C; "V1" -> section V with verse prefix 1 (unless a
        // section is literally labeled V1).
        let hit = pool.find((p) => p.label === ref);
        let prefix: string | null = null;
        if (!hit) {
          const vm = /^([A-Za-z]+)(\d+)$/.exec(ref);
          if (vm) {
            hit = pool.find((p) => p.label === vm[1]);
            if (hit) prefix = vm[2]!;
          }
        }
        return hit
          ? { id: crypto.randomUUID() as ArrangementSectionId, sectionId: hit.sectionId, repeats, prefix }
          : null;
      })
      .filter((as): as is NonNullable<typeof as> => as !== null);
    const existing = base.arrangements[0];
    const arr: SongArrangement = existing
      ? { ...existing, sequence, capo: Number.isFinite(capoNum) ? capoNum : null }
      : {
          id: crypto.randomUUID() as SongArrangement["id"],
          name: "Default",
          key: null, tempo: null, timeSignature: null,
          capo: Number.isFinite(capoNum) ? capoNum : null,
          notes: null, sequence,
        };
    return { ...base, arrangements: [arr, ...base.arrangements.slice(1)] };
  };

  const save = async () => {
    if (!song) return;
    const merged = applySource(song);
    if (!merged) return;
    await api.saveSong(applyPresentation(merged));
    setDirty(false);
    setStatus("Saved");
  };

  const remove = async () => {
    if (!song || !(await dlg.confirm(`Delete "${song.title}"?`))) return;
    await api.deleteSong(song.id);
    onBack?.();
  };

  /** OpenSong "Selected Song" group actions. */
  const rename = async () => {
    if (!song) return;
    const title = await dlg.prompt("Rename song:", song.title);
    if (title && title !== song.title) {
      update({ title });
      await save();
    }
  };
  const move = async () => {
    if (!song) return;
    const folder = await dlg.prompt("Move to folder (blank = library root):", song.folder ?? "");
    if (folder === null) return;
    update({ folder: folder.trim() || null });
    await save();
  };
  const copy = async () => {
    if (!song) return;
    const clone = {
      ...song,
      id: crypto.randomUUID() as Song["id"],
      title: `${song.title} (copy)`,
      revision: {
        id: crypto.randomUUID() as Song["revision"]["id"],
        parentId: null,
        origin: "web",
        createdAt: new Date().toISOString(),
      },
    };
    const created = await api.req<Song>("/api/v1/songs", { method: "POST", body: clone }).catch(() => null);
    if (created) {
      void api.logSongActivity(song.id, 8); // copied
      onCopied?.(created.id);
    }
  };
  const exportXml = () => {
    if (!song) return;
    const a = document.createElement("a");
    a.href = api.printUrl(`/api/v1/export/song/${encodeURIComponent(song.id)}`);
    a.download = `${song.title}.xml`;
    a.click();
  };

  const transpose = (semitones: number) => {
    if (!song) return;
    // In-place chord-token transpose (OpenSong parity): only chord names in
    // "." lines change; the rest of the document is untouched.
    const next = transposeSourceText(source, semitones, {});
    setSource(next);
    applySource(song, next);
    setDirty(true);
  };

  /** Verse-background list helpers (OpenSong <backgrounds> model). */
  const bgs = (): SongBackgrounds =>
    song?.backgrounds ?? { resize: "", keepAspect: false, link: false, asText: false, items: [] };
  const updateBg = (patch: Partial<SongBackgrounds>) => update({ backgrounds: { ...bgs(), ...patch } });

  const addBackground = async (verse: string, file: File) => {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]!);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const m = await api.uploadMedia(file.name, file.type || "image/png", dataUrl);
    updateBg({ items: [...bgs().items, { verse, key: m.storageKey, filename: file.name }] });
  };

  const mediaThumb = (key: string) => `/api/v1/media/${encodeURIComponent(key.split("/").pop() ?? key)}`;

  /** Insert text at the CodeMirror cursor (or append when unfocused). */
  const insertAtCursor = (text: string) => {
    const view = viewRef.current;
    if (!view) {
      setSource((s) => s + text);
    } else {
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    }
    setDirty(true);
  };

  const ins = {
    lyrics: async () => {
      const n = Number.parseInt((await dlg.prompt("Number of lines:", "4")) ?? "0", 10) || 0;
      if (n > 0) insertAtCursor("\n" + " \n".repeat(n));
    },
    comment: () => insertAtCursor("; "),
    column: () => insertAtCursor("|"),
    page: () => insertAtCursor("\n\n"),
    multiVerse: async () => {
      const lines = Number.parseInt((await dlg.prompt("Number of lines:", "2")) ?? "0", 10) || 0;
      const verses = Number.parseInt((await dlg.prompt("Number of verses:", "2")) ?? "0", 10) || 0;
      if (lines < 1 || verses < 1 || verses > 9) return;
      let out = "\n";
      for (let l = 0; l < lines; l++) for (let v = 1; v <= verses; v++) out += `${v} \n`;
      insertAtCursor(out);
    },
    section: async () => {
      const name = await dlg.prompt("Section name:", `V${(song?.sections.length ?? 0) + 1}`);
      if (name) insertAtCursor(`\n[${name}]\n`);
    },
  };

  if (!song) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {onBack && <button onClick={onBack} className={btn}>←</button>}
        <button
          onClick={() => setTab("general")}
          className={`${btn} ${tab === "general" ? "bg-indigo-100 dark:bg-indigo-950" : ""}`}
        >
          General
        </button>
        <button
          onClick={() => setTab("advanced")}
          className={`${btn} ${tab === "advanced" ? "bg-indigo-100 dark:bg-indigo-950" : ""}`}
        >
          Advanced
        </button>
        <button
          onClick={() => setTab("backgrounds")}
          className={`${btn} ${tab === "backgrounds" ? "bg-indigo-100 dark:bg-indigo-950" : ""}`}
        >
          Backgrounds
        </button>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <button onClick={() => void reload()} className={btn} title="Discard edits and reload">Revert</button>}
          {onPresent && <button onClick={() => void save().then(() => onPresent(song))} className={btn}>Present</button>}
          <span className="text-xs text-zinc-500">Transpose</span>
          <button onClick={() => transpose(-1)} className={btn}>-♭</button>
          <button onClick={() => transpose(1)} className={btn}>+♯</button>
          <button
            onClick={() => setPrintUrl(api.printUrl(`/api/v1/print/song/${encodeURIComponent(song.id)}?mode=chord`))}
            className={btn}
            title="Chord sheet"
          >
            Print
          </button>
          <button
            onClick={() => setPrintUrl(api.printUrl(`/api/v1/print/song/${encodeURIComponent(song.id)}?mode=lyrics`))}
            className={btn}
            title="Lyrics sheet"
          >
            Print lyrics
          </button>
          <button onClick={() => void save()} className="rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500">
            {dirty ? "Save" : "Saved"}
          </button>
          <button onClick={() => void rename()} className={btn} title="Rename song">Rename</button>
          <button onClick={exportXml} className={btn} title="Export as OpenSong XML">Export</button>
          <button onClick={() => void copy()} className={btn} title="Duplicate this song">Copy</button>
          <button onClick={() => void move()} className={btn} title="Move to folder">Move</button>
          <button onClick={() => void remove()} className={`${btn} text-red-600`}>Delete</button>
        </div>
      </div>
      {status && <p className="text-xs text-zinc-500">{status}</p>}

      {tab === "general" && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
          <Field label="Title" value={song.title} onChange={(v) => update({ title: v })} />
          <Field label="AKA" value={song.aka ?? ""} onChange={(v) => update({ aka: v || null })} />
          <Field label="Author" value={song.authors.join("; ")} onChange={(v) => update({ authors: v.split(";").map((a) => a.trim()).filter(Boolean) })} />
          <Field label="Copyright" value={song.copyright ?? ""} onChange={(v) => update({ copyright: v || null })} />
          <Field label="CCLI #" value={song.ccliNumber ?? ""} onChange={(v) => update({ ccliNumber: v || null })} />
          <Field
            label="Themes"
            value={[song.theme, song.secondaryTheme].filter(Boolean).join("; ")}
            onChange={(v) => {
              const [t, alt] = v.split(";").map((s) => s.trim());
              update({ theme: t || null, secondaryTheme: alt || null });
            }}
          />
          <Field label="Folder" value={song.folder ?? ""} onChange={(v) => update({ folder: v || null })} />
          <Field label="Key" value={song.defaultKey ?? ""} onChange={(v) => update({ defaultKey: v || null })} />
          <Field label="Key Line" value={song.keyLine ?? ""} onChange={(v) => update({ keyLine: v || null })} />
          <Field label="Tempo" value={song.tempo ?? ""} onChange={(v) => update({ tempo: v || null })} />
          <Field label="Time Signature" value={song.timeSignature ?? ""} onChange={(v) => update({ timeSignature: v || null })} />
          <Field label="Capo" value={capo} onChange={setCapo} />
          <Field label="Presentation" value={presentation} onChange={(v) => { setPresentation(v); setDirty(true); }} className="col-span-2" />
        </div>
      )}
      {tab === "advanced" && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
          <Field label={userLabels[0] ?? "User Defined 1"} value={song.userFields.user1} onChange={(v) => update({ userFields: { ...song.userFields, user1: v } })} />
          <Field label={userLabels[1] ?? "User Defined 2"} value={song.userFields.user2} onChange={(v) => update({ userFields: { ...song.userFields, user2: v } })} />
          <Field label={userLabels[2] ?? "User Defined 3"} value={song.userFields.user3} onChange={(v) => update({ userFields: { ...song.userFields, user3: v } })} />
          <Field label="Background" value={song.background ?? ""} onChange={(v) => update({ background: v || null })} />
          <Field label="Notes" value={song.notes ?? ""} onChange={(v) => update({ notes: v || null })} className="col-span-2" />
        </div>
      )}
      {tab === "backgrounds" && (
        <div className="flex flex-col gap-2 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="bg-resize" checked={bgs().resize === "screen"} onChange={() => updateBg({ resize: "screen" })} />
              Fit to screen
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="bg-resize" checked={bgs().resize === "body"} onChange={() => updateBg({ resize: "body" })} />
              Fit to body
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="bg-resize" checked={bgs().resize === ""} onChange={() => updateBg({ resize: "" })} />
              No resize
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={bgs().keepAspect} onChange={(e) => updateBg({ keepAspect: e.target.checked })} />
              Keep aspect
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={bgs().link} onChange={(e) => updateBg({ link: e.target.checked })} />
              Store as link
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={bgs().asText} onChange={(e) => updateBg({ asText: e.target.checked })} />
              Background as text
            </label>
          </div>
          <div>
            <span className="text-xs text-zinc-500">Verse specific backgrounds:</span>
            <div className="mt-1 flex flex-col gap-1">
              {bgs().items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded border border-zinc-300 p-1.5 dark:border-zinc-700">
                  <span className="w-16 text-sm font-medium">{item.verse || "(all)"}</span>
                  {item.key ? (
                    <img src={mediaThumb(item.key)} alt="" className="h-10 w-16 rounded object-cover" />
                  ) : (
                    <span className="text-xs text-zinc-500">{item.filename ?? "linked file"}</span>
                  )}
                  <span className="text-xs text-zinc-500">{item.filename ?? item.key ?? ""}</span>
                  <button
                    className={`${btn} ml-auto text-red-600`}
                    onClick={() => updateBg({ items: bgs().items.filter((_, j) => j !== i) })}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {bgs().items.length === 0 && <p className="text-xs text-zinc-500">No verse backgrounds. Pick a section and an image to add one.</p>}
            </div>
          </div>
          <BackgroundAdder sections={song.sections.map((s) => s.label)} onAdd={(v, f) => void addBackground(v, f)} />
        </div>
      )}

      {/* Chord/Lyrics */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Chord/Lyrics:</span>
        <span className="text-xs text-zinc-500">Insert:</span>
        <button onClick={ins.lyrics} className={btn}>Lyrics</button>
        <button onClick={ins.comment} className={btn}>Comment</button>
        <button onClick={ins.column} className={btn}>Column</button>
        <button onClick={ins.page} className={btn}>Page</button>
        <button onClick={ins.multiVerse} className={btn}>Multi-Verse</button>
        <button onClick={ins.section} className={btn}>Section</button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
        <CodeMirror
          value={source}
          height="100%"
          theme={dark ? "dark" : "light"}
          style={{ height: "100%" }}
          extensions={[opensongLanguage]}
          onCreateEditor={(view) => { viewRef.current = view; }}
          onChange={(v) => {
            setSource(v);
            setDirty(true);
          }}
        />
      </div>
    </div>
  );
}

/** Verse select + image picker -> uploads the file and appends a background. */
function BackgroundAdder({ sections, onAdd }: { sections: string[]; onAdd: (verse: string, file: File) => void }): ReactNode {
  const [verse, setVerse] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex items-center gap-2">
      <select className={input} value={verse} onChange={(e) => setVerse(e.target.value)}>
        <option value="">(all / every slide)</option>
        {sections.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onAdd(verse === "" ? verse : verse, f);
        e.target.value = "";
      }} />
      <button className={btn} onClick={() => fileRef.current?.click()}>Add background…</button>
    </div>
  );
}
