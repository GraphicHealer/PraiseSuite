import type {
  ChordAnnotation,
  LyricLine,
  SectionType,
  SongSection,
} from "../../domain/songs/types.js";
import { parseChord } from "../../domain/chords/parse.js";
import { transposeChord } from "../../domain/chords/transpose.js";

export interface LyricsParseResult {
  sections: ParsedSection[];
  warnings: string[];
}

/** A section before IDs are assigned — content identical to SongSection minus id. */
export type ParsedSection = Omit<SongSection, "id">;

const SECTION_RE = /^\[\s*([^\]]*?)\s*\]\s*(?:\(([^)]*)\))?\s*$/;

function sectionType(label: string): SectionType {
  switch (label.charAt(0).toUpperCase()) {
    case "V":
      return "verse";
    case "C":
      return "chorus";
    case "P":
      return "prechorus";
    case "B":
      return "bridge";
    case "T":
      return "tag";
    case "I":
      return "intro";
    case "O":
      return "outro";
    default:
      return "other";
  }
}

/**
 * OpenSong `[X](opt;k=v;flag)` header (SongML ParseSectionLine).
 * Also handles the legacy `Foo-L`/`FooL` bilingual suffix.
 */
function parseSectionHeader(line: string): {
  label: string;
  options: Record<string, string | null>;
} | null {
  const m = SECTION_RE.exec(line);
  if (!m) return null;
  let label = (m[1] ?? "").trim();
  const options: Record<string, string | null> = {};
  const optStr = m[2];
  if (optStr !== undefined) {
    for (const part of optStr.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) options[part.trim()] = null;
      else options[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  } else if (label.length > 1 && label.endsWith("L")) {
    options["L"] = null;
    label = label.slice(0, -1).trimEnd();
    if (label.endsWith("-")) label = label.slice(0, -1).trimEnd();
  }
  return { label, options };
}

/** Chord token positions in a '.' line. Offset = index-1: the lyric line's prefix char aligns with the '.' column. */
function chordAnnotations(chordLine: string): ChordAnnotation[] {
  const out: ChordAnnotation[] = [];
  let i = 1; // skip the '.' prefix
  while (i < chordLine.length) {
    if (chordLine[i] !== " ") {
      let end = i;
      while (end < chordLine.length && chordLine[end] !== " ") end++;
      out.push({ offset: i - 1, chord: parseChord(chordLine.slice(i, end)) });
      i = end;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Split a lyric line on | / || slide-break markers, re-basing chord
 * offsets into each piece. Returns null when the line is ONLY break
 * markers (a break with no text).
 */
function splitOnBreaks(
  text: string,
  chords: ChordAnnotation[],
): { text: string; chords: ChordAnnotation[] }[] {
  const pieces: { text: string; chords: ChordAnnotation[] }[] = [];
  const starts: number[] = [];
  let pos = 0;
  for (const piece of text.split(/\|+/)) {
    starts.push(pos);
    pieces.push({ text: piece, chords: [] });
    pos += piece.length;
    while (pos < text.length && text[pos] === "|") pos++;
  }
  pieces.forEach((piece, i) => {
    const start = starts[i]!;
    const nextStart = i + 1 < starts.length ? starts[i + 1]! : Number.MAX_SAFE_INTEGER;
    piece.chords = chords
      .filter((c) => c.offset >= start && c.offset < nextStart)
      .map((c) => ({ offset: c.offset - start, chord: c.chord }));
    piece.text = piece.text.trimEnd();
  });
  return pieces;
}

/**
 * Parse an OpenSong `<lyrics>` block into canonical sections (TAS 8.4):
 * `.` chord lines become offset-anchored annotations; `|`/`||` and blank
 * lines become slide breaks; `;` comments and `-` directives are preserved;
 * `1`-`9` line prefixes become the prefix column; `(L)` sections get
 * interleaved lang assignments.
 */
export function parseOpenSongLyrics(lyrics: string): LyricsParseResult {
  const warnings: string[] = [];
  const sections: ParsedSection[] = [];
  const raw = lyrics
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd());

  let section: ParsedSection | null = null;
  let pendingChords: ChordAnnotation[] = [];
  let pendingBreak = false;

  const ensureSection = (): ParsedSection => {
    if (!section) {
      section = { type: "other", label: "", lines: [], options: {} };
      sections.push(section);
    }
    return section;
  };

  const pushLine = (line: LyricLine) => {
    if (pendingBreak && line.breakBefore === "none") {
      line.breakBefore = "slide";
    }
    pendingBreak = false;
    ensureSection().lines.push(line);
  };

  for (const line of raw) {
    const c0 = line.charAt(0);
    if (line === "" || /^\|+$/.test(line)) {
      pendingBreak = true;
      pendingChords = []; // a blank/break line ends a chord block (SongML line-group rule)
      continue;
    }
    if (c0 === "[") {
      const parsed = parseSectionHeader(line);
      if (!parsed) {
        warnings.push(`Malformed section header: ${line}`);
        continue;
      }
      section = {
        type: sectionType(parsed.label),
        label: parsed.label,
        options: parsed.options,
        lines: [],
      };
      sections.push(section);
      pendingBreak = false;
      continue;
    }
    if (c0 === ".") {
      // A chord line annotates the lyric line(s) that follow it.
      pendingChords = pendingChords.concat(chordAnnotations(line));
      continue;
    }
    if (c0 === ";") {
      pushLine({
        text: line.slice(1),
        chords: [],
        breakBefore: "none",
        prefix: null,
        kind: "comment",
        lang: null,
      });
      continue;
    }
    if (c0 === "-") {
      pushLine({
        text: line.slice(1),
        chords: [],
        breakBefore: "none",
        prefix: null,
        kind: "directive",
        lang: null,
      });
      continue;
    }

    const isDigitPrefix = c0 >= "1" && c0 <= "9";
    const prefix = isDigitPrefix ? c0 : null;
    const text = isDigitPrefix || c0 === " " ? line.slice(1) : line;
    const pieces = splitOnBreaks(text, pendingChords);
    pendingChords = [];
    pieces.forEach((piece, idx) => {
      pushLine({
        text: piece.text,
        chords: piece.chords,
        breakBefore: idx > 0 ? "inline" : "none",
        prefix: idx === 0 ? prefix : null,
        kind: "lyric",
        lang: null,
      });
    });
  }

  // Second pass: interleaved lang 1/2 within bilingual (L) sections.
  for (const s of sections) {
    if (!("L" in s.options)) continue;
    let n = 0;
    for (const line of s.lines) {
      if (line.kind !== "lyric") continue;
      line.lang = (n % 2 === 0 ? 1 : 2) as 1 | 2;
      n++;
    }
  }

  if (pendingChords.length > 0) {
    warnings.push(
      "Chord line(s) at end of lyrics had no lyric line beneath them; chords dropped.",
    );
  }
  // Pre-tag content is legal OpenSong (untagged songs, comment preambles) —
  // only flag it when actual lyric lines float in front of tagged sections,
  // which usually means a missing [tag].
  const first = sections[0];
  if (
    sections.length > 1 &&
    first !== undefined &&
    first.label === "" &&
    first.lines.some((l) => l.kind === "lyric")
  ) {
    warnings.push(
      "Lyric lines found before the first [section] tag; wrapped in an implicit section.",
    );
  }
  return { sections, warnings };
}

/**
 * Transpose chord tokens in place within "." chord lines — OpenSong SongML's
 * Transpose behavior: only chord names change; lyric lines, comments,
 * directives, and all spacing are untouched. If a transposed name overruns
 * the next token's column, following tokens cascade right (columns re-pad,
 * as SongML does by padding rows to the longest slice).
 */
export function transposeSourceText(source: string, semitones: number, opts: { preferFlats?: boolean } = {}): string {
  if (semitones === 0) return source;
  return source
    .split("\n")
    .map((line) => {
      if (!line.startsWith(".")) return line;
      // Token = whitespace-separated chord name after the "." prefix.
      const parts: { start: number; end: number; name: string }[] = [];
      const re = /\S+/g;
      re.lastIndex = 1;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) parts.push({ start: m.index, end: m.index + m[0].length, name: m[0] });
      if (parts.length === 0) return line;
      let out = line.slice(0, parts[0]!.start);
      let cursor = parts[0]!.start;
      for (const p of parts) {
        // keep original spacing unless the previous token overran this column
        if (p.start > cursor) {
          out += line.slice(cursor, p.start);
          cursor = p.start;
        } else if (p.start < cursor) {
          out += " ";
          cursor += 1;
        }
        const name = transposeChord(
          parseChord(p.name),
          semitones,
          opts.preferFlats === undefined ? {} : { preferFlats: opts.preferFlats },
        ).display;
        out += name;
        cursor += name.length;
      }
      return out;
    })
    .join("\n");
}
