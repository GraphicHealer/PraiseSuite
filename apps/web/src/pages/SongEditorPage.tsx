import { useEffect, useRef, useState, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import {
  parseOpenSongLyrics,
  serializeOpenSongLyrics,
  transposeSection,
  type Song,
  type SongArrangement,
  type SongSectionId,
  type ArrangementSectionId,
} from "@praisesuite/core";
import { api } from "../api.js";
import { opensongLanguage } from "../opensong-language.js";

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
      return as.repeats > 1 ? `${label} x${as.repeats}` : label;
    })
    .join(" ");
}

/**
 * OpenSong-style song editor: metadata fields + a monospaced Chord/Lyrics
 * source box edited in raw notation ([V1], .chord lines, | breaks, ;comments),
 * with Insert helpers and General/Advanced tabs (MainWindow parity).
 */
export function SongEditorPage({ id, onBack }: { id: string; onBack: () => void }): ReactNode {
  const [song, setSong] = useState<Song | null>(null);
  const [tab, setTab] = useState<"general" | "advanced">("general");
  const [source, setSource] = useState("");
  const [presentation, setPresentation] = useState("");
  const [capo, setCapo] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    api.song(id).then((s) => {
      setSong(s);
      setSource(serializeOpenSongLyrics(s));
      setPresentation(presentationOf(s));
      setCapo(s.arrangements[0]?.capo?.toString() ?? "");
    });
  }, [id]);

  const update = (patch: Partial<Song>) => {
    setSong((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };

  /** Rebuild sections from edited source, preserving section ids by label. */
  const applySource = (base: Song): Song | null => {
    const { sections: parsed, warnings } = parseOpenSongLyrics(source);
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
        const label = m ? m[1]! : tok;
        const repeats = m ? Number.parseInt(m[2]!, 10) : 1;
        const hit = pool.find((p) => p.label === label);
        return hit
          ? { id: crypto.randomUUID() as ArrangementSectionId, sectionId: hit.sectionId, repeats }
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
    if (!song || !confirm(`Delete "${song.title}"?`)) return;
    await api.deleteSong(song.id);
    onBack();
  };

  const transpose = (semitones: number) => {
    if (!song) return;
    const merged = applySource(song);
    if (!merged) return;
    const next = {
      ...merged,
      sections: merged.sections.map((s) => transposeSection(s, semitones, { targetKey: null })),
    };
    setSong(next);
    setSource(serializeOpenSongLyrics(next));
    setDirty(true);
  };

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
    lyrics: () => {
      const n = Number.parseInt(prompt("Number of lines:", "4") ?? "0", 10) || 0;
      if (n > 0) insertAtCursor("\n" + " \n".repeat(n));
    },
    comment: () => insertAtCursor("; "),
    column: () => insertAtCursor("|"),
    page: () => insertAtCursor("\n\n"),
    multiVerse: () => {
      const lines = Number.parseInt(prompt("Number of lines:", "2") ?? "0", 10) || 0;
      const verses = Number.parseInt(prompt("Number of verses:", "2") ?? "0", 10) || 0;
      if (lines < 1 || verses < 1 || verses > 9) return;
      let out = "\n";
      for (let l = 0; l < lines; l++) for (let v = 1; v <= verses; v++) out += `${v} \n`;
      insertAtCursor(out);
    },
    section: () => {
      const name = prompt("Section name:", `V${(song?.sections.length ?? 0) + 1}`);
      if (name) insertAtCursor(`\n[${name}]\n`);
    },
  };

  if (!song) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  return (
    <div className="flex h-[calc(100vh-53px)] flex-col gap-2 p-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} className={btn}>←</button>
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
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-500">Transpose</span>
          <button onClick={() => transpose(-1)} className={btn}>-♭</button>
          <button onClick={() => transpose(1)} className={btn}>+♯</button>
          <button onClick={() => void save()} className="rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500">
            {dirty ? "Save" : "Saved"}
          </button>
          <button onClick={() => void remove()} className={`${btn} text-red-600`}>Delete</button>
        </div>
      </div>
      {status && <p className="text-xs text-zinc-500">{status}</p>}

      {tab === "general" ? (
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
          <Field label="Key" value={song.defaultKey ?? ""} onChange={(v) => update({ defaultKey: v || null })} />
          <Field label="Key Line" value={song.keyLine ?? ""} onChange={(v) => update({ keyLine: v || null })} />
          <Field label="Tempo" value={song.tempo ?? ""} onChange={(v) => update({ tempo: v || null })} />
          <Field label="Time Signature" value={song.timeSignature ?? ""} onChange={(v) => update({ timeSignature: v || null })} />
          <Field label="Capo" value={capo} onChange={setCapo} />
          <Field label="Presentation" value={presentation} onChange={(v) => { setPresentation(v); setDirty(true); }} className="col-span-2" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
          <Field label="User Defined 1" value={song.userFields.user1} onChange={(v) => update({ userFields: { ...song.userFields, user1: v } })} />
          <Field label="User Defined 2" value={song.userFields.user2} onChange={(v) => update({ userFields: { ...song.userFields, user2: v } })} />
          <Field label="User Defined 3" value={song.userFields.user3} onChange={(v) => update({ userFields: { ...song.userFields, user3: v } })} />
          <Field label="Background" value={song.background ?? ""} onChange={(v) => update({ background: v || null })} />
          <Field label="Notes" value={song.notes ?? ""} onChange={(v) => update({ notes: v || null })} className="col-span-2" />
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
