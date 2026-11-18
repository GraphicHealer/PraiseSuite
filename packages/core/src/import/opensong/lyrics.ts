import type {
  ChordAnnotation,
  LineBreak,
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
 * Split a lyric line on | / || break markers, re-basing chord offsets into
 * each piece. SongML: "|" is a line break WITHIN the slide (DeflateString
 * -> Chr(10)); "||" is the only slide boundary.
 */
function splitOnBreaks(
  text: string,
  chords: ChordAnnotation[],
): { text: string; chords: ChordAnnotation[]; break: LineBreak }[] {
  const pieces: { text: string; chords: ChordAnnotation[]; break: LineBreak }[] = [];
  const starts: number[] = [];
  let pos = 0;
  // split(/(\|+)/) alternates piece, separator, piece...
  const parts = text.split(/(\|+)/);
  for (let i = 0; i < parts.length; i += 2) {
    const piece = parts[i]!;
    const sep = i > 0 ? parts[i - 1]! : "";
    starts.push(pos);
    pieces.push({
      text: piece.trimEnd(),
      chords: [],
      break: sep.length >= 2 ? "bar" : sep.length === 1 ? "inline" : "none",
    });
    // Advance past this piece AND the separator that follows it.
    pos += piece.length + (i + 1 < parts.length ? parts[i + 1]!.length : 0);
  }
  pieces.forEach((piece, i) => {
    const start = starts[i]!;
    const nextStart = i + 1 < starts.length ? starts[i + 1]! : Number.MAX_SAFE_INTEGER;
    piece.chords = chords
      .filter((c) => c.offset >= start && c.offset < nextStart)
      .map((c) => ({ offset: c.offset - start, chord: c.chord }));
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
export function parseOpenSongLyrics(
  lyrics: string,
  opts?: { blankIsSlideChange?: boolean },
): LyricsParseResult {
  const warnings: string[] = [];
  const sections: ParsedSection[] = [];
  const raw = lyrics
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd());

  // Tagged sections collect in order; untagged (pre-[tag]) content uses
  // SongML's LyricsToSections dict model: a digit-prefixed line starts/extends
  // subsection "1".."9", everything else accumulates in "" (the default
  // subsection). Subsections keep first-appearance order and merge
  // non-consecutive same-key lines, exactly like OpenSong's dict.
  let section: ParsedSection | null = null;
  const defaultDict = new Map<string, ParsedSection>();
  const defaultOrder: string[] = [];
  let lastDefaultKey = "";
  const defaultSection = (key: string): ParsedSection => {
    let s = defaultDict.get(key);
    if (!s) {
      s = { type: "other", label: key, lines: [], options: {} };
      defaultDict.set(key, s);
      defaultOrder.push(key);
    }
    lastDefaultKey = key;
    return s;
  };

  let pendingChords: ChordAnnotation[] = [];
  let pendingBreak = false;
  // SongML FindLyricLineCount: one chord line covers every consecutive
  // digit-prefixed line, or one space-prefixed line (+1 when bilingual).
  let chordCover: "armed" | "digits" | "space" | "none" = "none";
  let coverSpaceLeft = 0;

  const pushLine = (line: LyricLine, defaultKey?: string) => {
    if (pendingBreak && line.breakBefore === "none") {
      line.breakBefore = "slide";
    }
    pendingBreak = false;
    const target = section ?? defaultSection(defaultKey ?? lastDefaultKey);
    target.lines.push(line);
  };

  const blankIsSlideChange = opts?.blankIsSlideChange === true;

  for (const line of raw) {
    const c0 = line.charAt(0);
    if (/^\|{2,}$/.test(line)) {
      // A line that is only "||" is a bare slide separator.
      pendingBreak = true;
      pendingChords = [];
      chordCover = "none";
      continue;
    }
    if (line === "" || /^\|$/.test(line)) {
      // SongML LyricsToSections drops blank lines unless
      // blank_is_slide_change is on (then AdjustSlideBreaks maps them to
      // "||"). A lone "|" deflates to an empty display line — same rule.
      if (blankIsSlideChange) {
        pendingBreak = true;
        pendingChords = [];
        chordCover = "none";
      }
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
      pendingChords = [];
      chordCover = "none";
      continue;
    }
    if (c0 === ".") {
      // A chord line annotates the lyric line(s) that follow it. Only
      // consecutive "." lines accumulate; a new "." after a consumed block
      // starts a fresh row.
      pendingChords = (chordCover === "armed" ? pendingChords : []).concat(chordAnnotations(line));
      chordCover = "armed";
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
      pendingChords = [];
      chordCover = "none";
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
      pendingChords = [];
      chordCover = "none";
      continue;
    }

    const isDigitPrefix = c0 >= "1" && c0 <= "9";
    const prefix = isDigitPrefix ? c0 : null;
    const text = isDigitPrefix || c0 === " " ? line.slice(1) : line;

    // Chord coverage: does this lyric line inherit the pending chord row?
    let covered = false;
    if (chordCover === "armed") {
      covered = true;
      if (isDigitPrefix) {
        chordCover = "digits";
      } else if (c0 === " ") {
        chordCover = "space";
        coverSpaceLeft = section !== null && "L" in section.options ? 1 : 0;
      } else {
        chordCover = "none";
      }
    } else if (chordCover === "digits" && isDigitPrefix) {
      covered = true;
    } else if (chordCover === "space" && c0 === " " && coverSpaceLeft > 0) {
      covered = true;
      coverSpaceLeft--;
      if (coverSpaceLeft === 0) chordCover = "none";
    } else {
      chordCover = "none";
    }
    const lineChords = covered ? pendingChords : [];
    if (!covered) pendingChords = [];
    // Once the block is fully consumed, clear for the next '.' line.
    if (chordCover === "none") pendingChords = [];

    const pieces = splitOnBreaks(text, lineChords);
    pieces.forEach((piece, idx) => {
      pushLine(
        {
          text: piece.text,
          chords: piece.chords,
          breakBefore: piece.break,
          prefix: idx === 0 ? prefix : null,
          kind: "lyric",
          lang: null,
        },
        prefix ?? "",
      );
    });
  }

  // Assemble: untagged subsections in first-appearance order, then tagged.
  const untagged = defaultOrder.map((k) => defaultDict.get(k)!);
  sections.unshift(...untagged);

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

  if (pendingChords.length > 0 && chordCover === "armed") {
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
