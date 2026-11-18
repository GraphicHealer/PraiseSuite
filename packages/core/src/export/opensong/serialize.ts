import type { Song, SongSection } from "../../domain/songs/types.js";
import type { Service } from "../../domain/services/types.js";

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
    // chars[k] renders at column k+1 (the '.' occupies column 0), and lyric
    // offset p also maps to column p+1 (the number prefix sits at column 0)
    // — so the chord lands at chars index `offset` exactly. Spread the name:
    // pushing it whole would count one element for several columns and push
    // every later chord right by (name.length - 1).
    const col = c.offset;
    while (chars.length < col) chars.push(" ");
    if (chars.length > col) chars.push(" "); // previous name overran: keep a gap
    chars.push(...c.chord.display);
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

/** Serialize just the lyric block (OpenSong <lyrics> notation) — used by source editors. */
export function serializeOpenSongLyrics(song: Pick<Song, "sections">): string {
  return song.sections.map(serializeSection).join("\n\n");
}

/** Serialize a Song to the OpenSong XML song format. */
export function serializeOpenSongSong(song: Song): string {
  const arr = song.arrangements[0];
  const presentation = arr
    ? arr.sequence
        .map((as) => {
          const label = song.sections.find((s) => s.id === as.sectionId)?.label ?? "";
          return label === "" ? "" : `${label}${as.prefix ?? ""}`;
        })
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
    `  <capo print="${arr?.capoPrint === true ? "true" : "false"}">${arr?.capo ?? ""}</capo>\n` +
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
    el("user1", song.userFields?.user1 ?? "") +
    "\n" +
    el("user2", song.userFields?.user2 ?? "") +
    "\n" +
    el("user3", song.userFields?.user3 ?? "") +
    "\n" +
    (song.background === null ? "" : el("background", song.background) + "\n") +
    serializeBackgrounds(song) +
    `  <lyrics>${escapeXml(lyrics)}</lyrics></song>\n`
  );
}

/** <backgrounds> block — verse-specific images with fit/link/as-text flags. */
function serializeBackgrounds(song: Song): string {
  const bg = song.backgrounds;
  if (bg == null || bg.items === undefined) return "";
  const items = bg.items
    .map(
      (i) =>
        `    <background verse="${escapeXml(i.verse)}">` +
        (i.filename !== null
          ? `<filename>${escapeXml(i.filename)}</filename>`
          : i.key !== null
            ? `<filename>${escapeXml(i.key)}</filename>`
            : "") +
        `</background>`,
    )
    .join("\n");
  return (
    `  <backgrounds resize="${escapeXml(bg.resize)}" keep_aspect="${bg.keepAspect}" ` +
    `link="${bg.link}" background_as_text="${bg.asText}">\n${items}\n  </backgrounds>\n`
  );
}

/** Serialize a Service to the OpenSong set format (<set><slide_groups>…). */
export function serializeOpenSongSet(service: Service, songTitle: (id: string) => string | null): string {
  const groups = service.items
    .map((item) => {
      const attrs = (type: string, name: string) =>
        `    <slide_group type="${type}" name="${escapeXml(name)}"` +
        (item.loopSeconds > 0 ? ` loop="true"` : "") +
        ` print="true" seconds="${item.loopSeconds || 0}">`;
      const common =
        (item.title ? `\n      <title>${escapeXml(item.title)}</title>` : "") +
        (item.subtitle ? `\n      <subtitle>${escapeXml(item.subtitle)}</subtitle>` : "") +
        (item.notes ? `\n      <notes>${escapeXml(item.notes)}</notes>` : "");
      if (item.kind === "song") {
        const name = item.songId === null ? item.title : (songTitle(item.songId) ?? item.title);
        return `${attrs("song", name)}\n    </slide_group>`;
      }
      if (item.kind === "scripture") {
        return `${attrs("scripture", item.title)}${common}\n    </slide_group>`;
      }
      // custom-slides / note / media / announcement -> OpenSong "custom" group
      const slides =
        item.slides.length === 0
          ? ""
          : `\n      <slides>\n${item.slides
              .map((s) => `        <slide>\n          <body>${escapeXml(s.body)}</body>\n        </slide>`)
              .join("\n")}\n      </slides>`;
      return `${attrs("custom", item.title)}${common}${slides}\n    </slide_group>`;
    })
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<set name="${escapeXml(service.name)}">\n` +
    `  <slide_groups>\n${groups}\n  </slide_groups>\n</set>\n`
  );
}
