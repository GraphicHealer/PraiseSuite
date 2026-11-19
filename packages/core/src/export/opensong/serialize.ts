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

/** Token for one arrangement sequence entry ("V1", "C", or "1" for untagged subsections). */
function seqToken(song: Song, as: { sectionId: string; prefix: string | null }): string {
  const label = song.sections.find((s) => s.id === as.sectionId)?.label ?? "";
  if (label === "") return "";
  // Untagged numeric subsections: label == prefix ("1") — don't double it.
  return as.prefix !== null && as.prefix !== label ? `${label}${as.prefix}` : label;
}

/** The order OpenSong would derive from the sections alone (LyricsToSections). */
function naturalOrderTokens(song: Song): string[] {
  const tokens: string[] = [];
  for (const s of song.sections) {
    const prefixes: string[] = [];
    for (const l of s.lines) {
      if (l.kind === "lyric" && l.prefix !== null && !prefixes.includes(l.prefix)) {
        prefixes.push(l.prefix);
      }
    }
    if (prefixes.length > 0) {
      for (const p of prefixes) tokens.push(p === s.label ? s.label : `${s.label}${p}`);
    } else if (s.label !== "") {
      tokens.push(s.label);
    }
  }
  return tokens;
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
  // The untagged "default" section has no header in OpenSong files (D8).
  const out: string[] = s.label === "" && Object.keys(s.options).length === 0 ? [] : [sectionHeader(s)];
  // "inline" break pieces rejoin into one source line (with merged chords).
  let pending: { text: string; chords: { offset: number; chord: { display: string } }[]; prefix: string } | null = null;
  // SongML FindLyricLineCount: one "." line covers a whole run of digit-
  // prefixed lines — dedupe identical chord rows across the run (R3).
  let lastDigitChord: string | null = null;

  const flush = () => {
    if (!pending) return;
    const cl = chordLine(pending);
    const isDigit = pending.prefix >= "1" && pending.prefix <= "9";
    if (cl !== "" && cl !== (isDigit ? lastDigitChord : null)) out.push(cl);
    lastDigitChord = isDigit && cl !== "" ? cl : null;
    out.push(pending.prefix + pending.text);
    pending = null;
  };

  for (const line of s.lines) {
    if (line.breakBefore === "slide") {
      flush();
      out.push("");
      lastDigitChord = null;
    }
    if (line.kind !== "lyric") {
      flush();
      out.push((line.kind === "comment" ? ";" : "-") + line.text);
      lastDigitChord = null;
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
    if (line.breakBefore === "bar" && pending) {
      const base = pending.text.length + 2; // rejoin via "||" slide break
      pending.text += "||" + line.text;
      pending.chords.push(
        ...line.chords.map((c) => ({ offset: base + c.offset, chord: c.chord })),
      );
      continue;
    }
    if (line.breakBefore === "bar") {
      // Leading "||" with nothing pending: keep the slide boundary visible.
      flush();
      out.push("||");
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
  const seqTokens = arr ? arr.sequence.map((as) => seqToken(song, as)).filter((t) => t !== "") : [];
  const presentationRaw = song.presentationRaw ?? null;
  // <presentation>: write the raw source order when it still matches the
  // sequence; when the file had none, keep it empty unless the order
  // actually differs from the natural section expansion (D8).
  const presentation =
    presentationRaw !== null && presentationRaw.trim().split(/\s+/).join(" ") === seqTokens.join(" ")
      ? presentationRaw
      : presentationRaw === null && seqTokens.join(" ") === naturalOrderTokens(song).join(" ")
        ? ""
        : seqTokens.join(" ");

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
    el("time_sig", song.timeSignature) +
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
    (song.hymnNumber === null || song.hymnNumber === undefined ? "" : el("hymn_number", song.hymnNumber) + "\n") +
    ((song.linkedSongs ?? []).length === 0 ? "" : el("linked_songs", song.linkedSongs.join("\n")) + "\n") +
    (song.notes === null || song.notes === undefined ? "" : el("notes", song.notes) + "\n") +
    (song.background === null ? "" : el("background", song.background) + "\n") +
    serializeBackgrounds(song) +
    `  <lyrics>${escapeXml(lyrics)}</lyrics>\n` +
    // Unmodeled source elements round-trip verbatim (<style>, <pitch>, …).
    (song.extras ?? []).map((x) => `  ${x}\n`).join("") +
    `</song>\n`
  );
}

/** <backgrounds> block — verse-specific images with fit/link/as-text flags. */
function serializeBackgrounds(song: Song): string {
  const bg = song.backgrounds;
  if (bg == null || bg.items === undefined) return "";
  const items = bg.items
    .map((i) => {
      // OpenSong <filename> is a Backgrounds/ file name — emit the original
      // name, never a raw storage key path (D8).
      const name = i.filename ?? (i.key !== null ? (i.key.split("/").pop() ?? null) : null);
      return (
        `    <background verse="${escapeXml(i.verse)}">` +
        (name !== null ? `<filename>${escapeXml(name)}</filename>` : "") +
        `</background>`
      );
    })
    .join("\n");
  return (
    `  <backgrounds resize="${escapeXml(bg.resize)}" keep_aspect="${bg.keepAspect}" ` +
    `link="${bg.link}" background_as_text="${bg.asText}">\n${items}\n  </backgrounds>\n`
  );
}

/** Serialize a Service to the OpenSong set format (<set><slide_groups>…). */
export function serializeOpenSongSet(
  service: Service,
  songRef: (id: string) => { name: string; folder: string | null } | null,
  /** Resolves a media storageKey -> base64 for re-embedding <image> data. */
  imageData?: (storageKey: string) => string | null,
): string {
  const slides = (item: Service["items"][number]) =>
    item.slides.length === 0
      ? ""
      : `\n      <slides>\n${item.slides
          .map((s) => `        <slide>\n          <body>${escapeXml(s.body)}</body>\n        </slide>`)
          .join("\n")}\n      </slides>`;
  const groups = service.items
    .map((item) => {
      // OpenSong attrs: loop/seconds only for looping groups; print/
      // presentation/transition/path only when the item actually sets them.
      const attrs = (type: string, name: string, extra = "") => {
        // OpenSong @seconds (auto-advance) and @loop (group wrap) are
        // independent attrs — config wins, loopSeconds is the legacy field.
        const seconds =
          typeof item.config["seconds"] === "number"
            ? (item.config["seconds"] as number)
            : item.loopSeconds;
        const loop =
          item.config["loop"] === true || item.config["loop"] === "true" || item.loopSeconds > 0;
        return (
          `    <slide_group type="${type}" name="${escapeXml(name)}"` +
          (seconds > 0 ? ` seconds="${seconds}"` : "") +
          (loop ? ` loop="true"` : "") +
        (typeof item.config["print"] === "string" ? ` print="${escapeXml(item.config["print"] as string)}"` : "") +
        (typeof item.config["presentation"] === "string"
          ? ` presentation="${escapeXml(item.config["presentation"] as string)}"`
          : "") +
        (typeof item.config["transition"] === "string"
          ? ` transition="${escapeXml(item.config["transition"] as string)}"`
          : "") +
        extra +
        `>`
        );
      };
      const common =
        (item.title ? `\n      <title>${escapeXml(item.title)}</title>` : "") +
        (item.subtitle ? `\n      <subtitle>${escapeXml(item.subtitle)}</subtitle>` : "") +
        (item.notes ? `\n      <notes>${escapeXml(item.notes)}</notes>` : "");
      if (item.kind === "song") {
        const ref = item.songId === null ? null : songRef(item.songId);
        const name = ref?.name ?? item.title;
        const path = ref?.folder ? ` path="${escapeXml(ref.folder)}"` : "";
        return `${attrs("song", name, path)}\n    </slide_group>`;
      }
      if (item.kind === "scripture") {
        return `${attrs("scripture", item.title)}${common}${slides(item)}\n    </slide_group>`;
      }
      if (item.kind === "style") {
        // OpenSong style-change item: @action new|revert + <style> doc.
        const action = typeof item.config["action"] === "string" ? ` action="${escapeXml(item.config["action"] as string)}"` : "";
        const styleXml =
          typeof item.config["styleXml"] === "string"
            ? `\n      ${item.config["styleXml"]}`
            : styleOverrideXml(item.config["style"] as import("../../domain/styles/types.js").SlideStyleOverride | undefined);
        return `${attrs("style", item.title, action)}${styleXml}\n    </slide_group>`;
      }
      if (item.kind === "media" && item.config["openSongType"] === "image") {
        const name = typeof item.config["imagePath"] === "string" ? item.config["imagePath"] : item.title;
        const resize = typeof item.config["resize"] === "string" ? ` resize="${escapeXml(item.config["resize"] as string)}"` : "";
        const keepAspect = typeof item.config["keepAspect"] === "string" ? ` keep_aspect="${escapeXml(item.config["keepAspect"] as string)}"` : "";
        const images = Array.isArray(item.config["images"])
          ? (item.config["images"] as { storageKey?: string; filename?: string; description?: string }[])
          : [];
        const imgSlides =
          images.length === 0
            ? ""
            : `\n      <slides>\n${images
                .map((img) => {
                  const inner =
                    // OpenSong accepts <image> + <filename> together; keep
                    // both when we have them (re-review R4).
                    (img.storageKey !== undefined && imageData !== undefined && imageData(img.storageKey) !== null
                      ? `<image>${imageData(img.storageKey)}</image>`
                      : "") +
                    (img.filename !== undefined
                      ? `<filename>${escapeXml(img.filename)}</filename>`
                      : "") +
                    (img.description !== undefined ? `<description>${escapeXml(img.description)}</description>` : "");
                  return `        <slide>\n          ${inner}\n        </slide>`;
                })
                .join("\n")}\n      </slides>`;
        return `${attrs("image", name, `${resize}${keepAspect}`)}${common}${imgSlides}\n    </slide_group>`;
      }
      // custom-slides / note / announcement -> OpenSong "custom" group
      return `${attrs("custom", item.title)}${common}${slides(item)}\n    </slide_group>`;
    })
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<set name="${escapeXml(service.name)}">\n` +
    `  <slide_groups>\n${groups}\n  </slide_groups>\n</set>\n`
  );
}

/** Serialize a <style> override node back to OpenSong XML (style-change items). */
function styleOverrideXml(
  o: import("../../domain/styles/types.js").SlideStyleOverride | undefined,
): string {
  if (o === undefined) return "";
  const font = (t: import("../../domain/styles/types.js").TextStyleOverride | undefined, name: string) => {
    if (t === undefined) return "";
    const a: string[] = [];
    const push = (k: string, v: unknown) => { if (v !== undefined) a.push(`${k}="${escapeXml(String(v))}"`); };
    push("font", t.font); push("size", t.size); push("bold", t.bold); push("italic", t.italic);
    push("underline", t.underline); push("color", t.color); push("border", t.border);
    push("border_color", t.borderColor); push("shadow", t.shadow); push("shadow_color", t.shadowColor);
    push("fill", t.fill); push("fill_color", t.fillColor); push("align", t.align); push("valign", t.valign);
    push("enabled", t.enabled); push("auto_scale", t.autoScale);
    return `\n      <${name} ${a.join(" ")}/>`;
  };
  const bg =
    o.backgroundColor === undefined && o.backgroundKey === undefined
      ? ""
      : `\n      <background${o.backgroundColor !== undefined ? ` color="${escapeXml(o.backgroundColor)}"` : ""}${o.backgroundKey != null && !String(o.backgroundKey).startsWith("media/") ? ` filename="${escapeXml(String(o.backgroundKey))}"` : ""}/>`;
  return `<style>${font(o.title, "title")}${font(o.body, "body")}${font(o.subtitle, "subtitle")}${bg}\n      </style>`;
}
