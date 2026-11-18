import type { Song, SongSection } from "../../domain/songs/types.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sectionHeader(s: SongSection): string {
  const opts = Object.entries(s.options)
    .map(([k, v]) => (v === null ? k : `${k}=${v}`))
    .join(";");
  return `[${s.label}]${opts ? `(${opts})` : ""}`;
}

/** Rebuild a '.' chord line aligned to the given text length. */
function chordLine(line: { text: string; chords: { offset: number; chord: { display: string } }[] }): string {
  if (line.chords.length === 0) return "";
  const chars: string[] = [];
  for (const c of line.chords) {
    const col = c.offset + 1; // '.' occupies column 0
    while (chars.length < col) chars.push(" ");
    chars.push(c.chord.display);
  }
  return "." + chars.join("").trimEnd();
}

/** Serialize one section back to OpenSong lyric text. */
function serializeSection(s: SongSection): string {
  const out: string[] = [sectionHeader(s)];
  // "inline" break pieces rejoin into one source line (with merged chords).
  let pending: { text: string; chords: { offset: number; chord: { display: string } }[]; prefix: string } | null = null;

  const flush = () => {
    if (!pending) return;
    const cl = chordLine(pending);
    if (cl !== "") out.push(cl);
    out.push(pending.prefix + pending.text);
    pending = null;
  };

  for (const line of s.lines) {
    if (line.breakBefore === "slide") {
      flush();
      out.push("");
    }
    if (line.kind !== "lyric") {
      flush();
      out.push((line.kind === "comment" ? ";" : "-") + line.text);
      continue;
    }
    if (line.breakBefore === "inline" && pending) {
      const base = pending.text.length + 1; // rejoin via "|"
      pending.text += "|" + line.text;
      pending.chords.push(
        ...line.chords.map((c) => ({ offset: base + c.offset, chord: c.chord })),
      );
      continue;
    }
    flush();
    pending = {
      text: line.text,
      chords: line.chords.map((c) => ({ offset: c.offset, chord: c.chord })),
      prefix: line.prefix ?? " ",
    };
  }
  flush();
  return out.join("\n");
}

/** Serialize a Song to the OpenSong XML song format. */
export function serializeOpenSongSong(song: Song): string {
  const arr = song.arrangements[0];
  const presentation = arr
    ? arr.sequence
        .map((as) => song.sections.find((s) => s.id === as.sectionId)?.label ?? "")
        .filter(Boolean)
        .join(" ")
    : "";

  const el = (tag: string, value: string | null | number | undefined) =>
    `  <${tag}>${escapeXml(value === null || value === undefined ? "" : String(value))}</${tag}>`;

  const lyrics = song.sections.map(serializeSection).join("\n\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<song>\n` +
    el("title", song.title) +
    "\n" +
    el("author", song.authors.join("; ")) +
    "\n" +
    el("copyright", song.copyright) +
    "\n" +
    el("presentation", presentation) +
    "\n" +
    `  <capo print="">${arr?.capo ?? ""}</capo>\n` +
    el("tempo", song.tempo) +
    "\n" +
    el("timesig", song.timeSignature) +
    "\n" +
    el("ccli", song.ccliNumber) +
    "\n" +
    el("theme", song.theme) +
    "\n" +
    el("alttheme", song.secondaryTheme) +
    "\n" +
    el("aka", song.aka) +
    "\n" +
    el("key", song.defaultKey) +
    "\n" +
    el("key_line", song.keyLine) +
    "\n" +
    el("user1", song.userFields.user1) +
    "\n" +
    el("user2", song.userFields.user2) +
    "\n" +
    el("user3", song.userFields.user3) +
    "\n" +
    `  <lyrics>${escapeXml(lyrics)}</lyrics></song>\n`
  );
}
