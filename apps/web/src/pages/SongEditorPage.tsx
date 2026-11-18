import { useEffect, useMemo, useState, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  parseChord,
  parseOpenSongLyrics,
  serializeOpenSongLyrics,
  transposeSection,
  type Song,
  type SongSection,
  type SongSectionId,
} from "@praisesuite/core";
import { api } from "../api.js";
import { opensongLanguage } from "../opensong-language.js";

type Mode = "visual" | "source";

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

export function SongEditorPage({ id, onBack }: { id: string; onBack: () => void }): ReactNode {
  const [song, setSong] = useState<Song | null>(null);
  const [mode, setMode] = useState<Mode>("visual");
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api.song(id).then((s) => {
      setSong(s);
      setSource(serializeOpenSongLyrics(s));
    });
  }, [id]);

  const update = (patch: Partial<Song>) => {
    setSong((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };

  const updateSection = (i: number, patch: Partial<SongSection>) => {
    if (!song) return;
    const sections = song.sections.map((s, j) => (j === i ? { ...s, ...patch } : s));
    update({ sections });
  };

  /** Rebuild sections from edited source text, preserving section ids by label where possible. */
  const applySource = (): Song | null => {
    if (!song) return null;
    const { sections: parsed, warnings } = parseOpenSongLyrics(source);
    const byLabel = new Map(song.sections.map((s) => [s.label, s.id]));
    const used = new Set<string>();
    const sections = parsed.map((s) => {
      let sid = byLabel.get(s.label);
      if (sid && used.has(sid)) sid = undefined;
      if (!sid) sid = crypto.randomUUID() as SongSectionId;
      used.add(sid);
      return { ...s, id: sid };
    });
    const valid = new Set(sections.map((s) => s.id));
    const arrangements = song.arrangements.map((a) => ({
      ...a,
      sequence: a.sequence.filter((as) => valid.has(as.sectionId)),
    }));
    const next = { ...song, sections, arrangements };
    setSong(next);
    setStatus(warnings.length ? `Parsed with ${warnings.length} warning(s)` : "Applied source");
    return next;
  };

  const save = async () => {
    if (!song) return;
    const latest = mode === "source" ? applySource() : song;
    if (!latest) return;
    await api.saveSong(latest);
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
    update({
      sections: song.sections.map((s) => transposeSection(s, semitones, { targetKey: null })),
    });
  };

  const sectionsView = useMemo(() => song?.sections ?? [], [song]);

  if (!song) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className={btn}>← Library</button>
        <h1 className="text-lg font-semibold">{song.title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => transpose(-1)} className={btn}>-♭</button>
          <button onClick={() => transpose(1)} className={btn}>+♯</button>
          <button onClick={() => setMode(mode === "visual" ? "source" : "visual")} className={btn}>
            {mode === "visual" ? "Source" : "Visual"}
          </button>
          <button onClick={() => void save()} className="rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500">
            {dirty ? "Save" : "Saved"}
          </button>
          <button onClick={() => void remove()} className={`${btn} text-red-600`}>Delete</button>
        </div>
      </div>
      {status && <p className="mb-2 text-xs text-zinc-500">{status}</p>}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Title" value={song.title} onChange={(v) => update({ title: v })} />
        <Field label="Authors" value={song.authors.join("; ")} onChange={(v) => update({ authors: v.split(";").map((a) => a.trim()).filter(Boolean) })} />
        <Field label="Theme" value={song.theme ?? ""} onChange={(v) => update({ theme: v || null })} />
        <Field label="Key" value={song.defaultKey ?? ""} onChange={(v) => update({ defaultKey: v || null })} />
        <Field label="Tempo" value={song.tempo ?? ""} onChange={(v) => update({ tempo: v || null })} />
        <Field label="Time sig" value={song.timeSignature ?? ""} onChange={(v) => update({ timeSignature: v || null })} />
        <Field label="CCLI" value={song.ccliNumber ?? ""} onChange={(v) => update({ ccliNumber: v || null })} />
        <Field label="Copyright" value={song.copyright ?? ""} onChange={(v) => update({ copyright: v || null })} />
      </div>

      {mode === "source" ? (
        <div className="overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
          <CodeMirror
            value={source}
            height="60vh"
            extensions={[opensongLanguage]}
            onChange={(v) => {
              setSource(v);
              setDirty(true);
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {sectionsView.map((section, si) => (
            <section key={section.id} className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 flex items-center gap-2">
                <input
                  className={`${input} w-24 font-semibold`}
                  value={section.label}
                  onChange={(e) => updateSection(si, { label: e.target.value })}
                />
                <span className="text-xs text-zinc-500">{section.type}</span>
                <button
                  onClick={() => update({ sections: song.sections.filter((_, j) => j !== si) })}
                  className="ml-auto text-xs text-red-600"
                >
                  Remove section
                </button>
              </div>
              {section.lines.map((line, li) => (
                <div key={li} className="mb-1">
                  <div className="flex flex-wrap items-center gap-1">
                    {line.chords.map((c, ci) => (
                      <span key={ci} className="group relative rounded bg-indigo-100 px-1.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                        {c.chord.display}@{c.offset}
                        <button
                          onClick={() => {
                            const lines = section.lines.map((l, j) =>
                              j === li ? { ...l, chords: l.chords.filter((_, k) => k !== ci) } : l,
                            );
                            updateSection(si, { lines });
                          }}
                          className="ml-1 hidden text-red-600 group-hover:inline"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => {
                        const name = prompt("Chord (e.g. G/B):", "G");
                        const off = prompt("Offset:", String(line.text.length));
                        if (!name || off === null) return;
                        const lines = section.lines.map((l, j) =>
                          j === li
                            ? {
                                ...l,
                                chords: [
                                  ...l.chords,
                                  { offset: Math.max(0, Number.parseInt(off, 10) || 0), chord: parseChord(name) },
                                ].sort((a, b) => a.offset - b.offset),
                              }
                            : l,
                        );
                        updateSection(si, { lines });
                      }}
                      className="text-xs text-indigo-600"
                    >
                      + chord
                    </button>
                    <button
                      onClick={() => updateSection(si, { lines: section.lines.filter((_, j) => j !== li) })}
                      className="ml-auto text-xs text-zinc-400 hover:text-red-600"
                    >
                      remove line
                    </button>
                  </div>
                  <input
                    className={`${input} mt-0.5 w-full font-mono`}
                    value={line.text}
                    onChange={(e) => {
                      const lines = section.lines.map((l, j) => (j === li ? { ...l, text: e.target.value } : l));
                      updateSection(si, { lines });
                    }}
                  />
                </div>
              ))}
              <button
                onClick={() =>
                  updateSection(si, {
                    lines: [
                      ...section.lines,
                      { text: "", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: null },
                    ],
                  })
                }
                className="mt-1 text-xs text-indigo-600"
              >
                + line
              </button>
            </section>
          ))}
          <button
            onClick={() =>
              update({
                sections: [
                  ...song.sections,
                  {
                    id: crypto.randomUUID() as SongSectionId,
                    type: "verse",
                    label: `V${song.sections.length + 1}`,
                    options: {},
                    lines: [],
                  },
                ],
              })
            }
            className={btn}
          >
            + Section
          </button>
        </div>
      )}
    </div>
  );
}
