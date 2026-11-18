import type { Song, SongSection } from "../../domain/songs/types.js";
import type { TextStyle } from "../../domain/styles/types.js";
import { capoFingering, transposeChord } from "../../domain/chords/transpose.js";
import { parseChord } from "../../domain/chords/parse.js";
import { esc, printPage, roleCss } from "./layout.js";

export interface SheetOptions {
  /** Semitones to transpose chord rows by (musician transpose). */
  transpose?: number | undefined;
  /** Capo fret — adds a capo-fingering chord row per line (capo_chords role). */
  capo?: number | undefined;
  /** Per-role print styles (imported PrintSettings); missing roles get defaults. */
  roles?: Record<string, TextStyle> | undefined;
}

/**
 * Merge "|" inline pieces into one written line: text joined with a space,
 * chords shifted by the junction. Mirrors serialize.ts's rejoin rule.
 */
function writtenLines(section: SongSection): { text: string; chords: { offset: number; display: string }[]; prefix: string }[] {
  const out: { text: string; chords: { offset: number; display: string }[]; prefix: string }[] = [];
  let pending: { text: string; chords: { offset: number; display: string }[]; prefix: string } | null = null;
  const flush = () => {
    if (pending) { out.push(pending); pending = null; }
  };
  for (const line of section.lines) {
    if (line.kind !== "lyric") {
      flush();
      continue;
    }
    if (line.breakBefore === "slide") flush();
    if (line.breakBefore === "inline" && pending) {
      const base = pending.text.length + 1; // "|" prints as a space
      pending.text += " " + line.text;
      pending.chords.push(...line.chords.map((c) => ({ offset: base + c.offset, display: c.chord.display })));
      continue;
    }
    flush();
    pending = {
      text: line.text,
      chords: line.chords.map((c) => ({ offset: c.offset, display: c.chord.display })),
      prefix: line.prefix ?? " ",
    };
  }
  flush();
  return out;
}

/** Monospace chord row: chord names placed at their character offsets. */
function chordRow(chords: { offset: number; display: string }[]): string {
  const chars: string[] = [];
  for (const c of [...chords].sort((a, b) => a.offset - b.offset)) {
    while (chars.length < c.offset + 1) chars.push(" "); // +1: lyric text starts col 1
    if (chars.length > c.offset + 1) chars.push(" "); // previous name overran: keep a gap
    chars.push(c.display);
  }
  return chars.join("").trimEnd();
}

/**
 * Song -> printable chord sheet HTML.
 * Chord sheets keep "_" padding (syllable stretch shown as alignment gaps);
 * transpose and capo options follow OpenSong's print modes.
 */
export function chordSheetHtml(song: Song, opts: SheetOptions = {}): string {
  const roles = opts.roles ?? {};
  const tr = opts.transpose ?? 0;
  const capo = opts.capo ?? song.arrangements[0]?.capo ?? 0;
  const mapChord = (display: string): string => {
    const c = parseChordish(display);
    return tr !== 0 ? transposeChord(c, tr, {}).display : c.display;
  };
  const mapCapo = (display: string): string => {
    const c = parseChordish(display);
    const t = tr !== 0 ? transposeChord(c, tr, {}).display : c.display;
    return capo > 0 ? capoFingering(parseChordish(t), capo).display : t;
  };

  const parts: string[] = [];
  // OpenSong lead-sheet header: title left, author right-aligned, one baseline.
  parts.push(
    `<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #888;padding-bottom:2pt">` +
      `<span style="${roleCss(roles["title"])};font-size:16pt;font-weight:bold">${esc(song.title)}</span>` +
      `<span style="${roleCss(roles["author"])}">${esc(song.authors.join("; "))}</span>` +
    `</div>`,
  );
  const meta: string[] = [];
  if (song.defaultKey) meta.push(`Key: ${esc(song.defaultKey)}`);
  if (capo > 0) meta.push(`Capo ${capo}`);
  if (song.tempo) meta.push(`Tempo: ${esc(song.tempo)}`);
  if (song.timeSignature) meta.push(song.timeSignature);
  if (meta.length) parts.push(`<div style="${roleCss(roles["capo_chords"])};color:#666;margin-top:2pt">${meta.join(" - ")}</div>`);

  for (const section of song.sections) {
    parts.push(`<div class="ps-sec"><div style="${roleCss(roles["heading"])};font-weight:bold">${esc(section.label)}</div>`);
    for (const wl of writtenLines(section)) {
      const chords = wl.chords.map((c) => ({ offset: c.offset, display: mapChord(c.display) }));
      const cr = chordRow(chords);
      if (capo > 0) {
        const capoRow = chordRow(wl.chords.map((c) => ({ offset: c.offset, display: mapCapo(c.display) })));
        if (capoRow) parts.push(`<div class="ps-line" style="${roleCss(roles["capo_chords"])};font-family:monospace">${esc(capoRow)}</div>`);
      }
      if (cr) parts.push(`<div class="ps-line" style="${roleCss(roles["chords"])};font-family:monospace;font-weight:bold">${esc(cr)}</div>`);
      parts.push(`<div class="ps-line" style="${roleCss(roles["lyrics"])};font-family:monospace">${esc(wl.prefix === " " ? wl.text : wl.prefix + wl.text)}</div>`);
    }
    parts.push("</div>");
  }
  if (song.copyright) parts.push(`<div style="${roleCss(roles["copyright"])};margin-top:14pt;color:#777;font-size:8pt">Copyright © ${esc(song.copyright)}</div>`);
  return printPage(`${song.title} — chord sheet`, parts.join("\n"));
}

/**
 * Lyrics-only sheet: same sections, no chord rows, underscores stripped and
 * spaces squeezed (matches OpenSong lyric-sheet/presenter text).
 */
export function lyricsSheetHtml(song: Song, opts: SheetOptions = {}): string {
  const roles = opts.roles ?? {};
  const clean = (t: string) => t.replace(/_/g, "").replace(/ {2,}/g, " ").replace(/^ +/, "");
  const parts: string[] = [];
  parts.push(`<h1 style="${roleCss(roles["title"])};margin-bottom:2pt">${esc(song.title)}</h1>`);
  if (song.authors.length) parts.push(`<div style="${roleCss(roles["author"])}">${esc(song.authors.join("; "))}</div>`);
  for (const section of song.sections) {
    parts.push(`<div class="ps-sec"><div style="${roleCss(roles["heading"])};font-weight:bold">${esc(section.label)}</div>`);
    for (const wl of writtenLines(section)) {
      const text = (wl.prefix === " " ? "" : wl.prefix) + wl.text;
      parts.push(`<div class="ps-line" style="${roleCss(roles["lyrics"])};font-family:sans-serif">${esc(clean(text))}</div>`);
    }
    parts.push("</div>");
  }
  if (song.copyright) parts.push(`<div style="${roleCss(roles["copyright"])};margin-top:14pt;color:#777;font-size:8pt">${esc(song.copyright)}</div>`);
  return printPage(`${song.title} — lyrics`, parts.join("\n"));
}

// transposeChord echoes .raw for unparseable input.
function parseChordish(display: string) {
  return parseChord(display);
}
