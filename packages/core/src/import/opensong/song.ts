import type {
  Song,
  SongArrangement,
  SongSection,
} from "../../domain/songs/types.js";
import type { IdGenerator } from "../../ports/index.js";
import { parseOpenSongLyrics } from "./lyrics.js";
import { asRecord, asString, attrOf, parseXml, textOf } from "./xml.js";

/** Arrangement draft referencing sections by index into ParsedSong.sections (ids assigned later). */
export interface ParsedArrangement extends Omit<SongArrangement, "id" | "sequence"> {
  sequence: { sectionIndex: number; repeats: number; prefix: string | null }[];
}

/** A Song without ids/revision — assigned by materializeSong(). */
/** Parsed backgrounds carry embedded image data; applyImport stores it as media. */
export interface ParsedSongBackgrounds {
  resize: string;
  keepAspect: boolean;
  link: boolean;
  asText: boolean;
  items: { verse: string; filename: string | null; imageData: string | null; key?: string | null }[];
}

export type ParsedSong = Omit<Song, "id" | "revision" | "sections" | "arrangements" | "backgrounds"> & {
  sections: Omit<SongSection, "id">[];
  arrangements: ParsedArrangement[];
  backgrounds: ParsedSongBackgrounds | null;
};

export interface SongParseResult {
  song: ParsedSong;
  warnings: string[];
}

/** <backgrounds> element -> verse-specific images (OpenSong backgrounds tab). */
function parseBackgrounds(el: unknown): ParsedSongBackgrounds | null {
  const rec = asRecord(el);
  const kids = rec["background"];
  if (kids === undefined && rec["@_resize"] === undefined) return null;
  const list = Array.isArray(kids) ? kids : kids === undefined ? [] : [kids];
  return {
    resize: asString(rec["@_resize"]),
    keepAspect: asString(rec["@_keep_aspect"]) === "true",
    link: asString(rec["@_link"]) === "true",
    asText: asString(rec["@_background_as_text"]) === "true",
    items: list.map((b) => {
      const r = asRecord(b);
      return {
        verse: asString(r["@_verse"]),
        filename: str(r["filename"]),
        imageData: str(r["image"]),
      };
    }),
  };
}

function str(v: unknown): string | null {
  const s = asString(v).trim();
  return s === "" ? null : s;
}

/** Top-level <song> elements PraiseSuite models — anything else is kept raw in extras. */
const KNOWN_SONG_TAGS = new Set([
  "title", "author", "copyright", "presentation", "capo", "tempo", "timesig",
  "time_sig", "ccli", "theme", "alttheme", "aka", "key", "key_line",
  "user1", "user2", "user3", "background", "backgrounds", "lyrics",
  "hymn_number", "linked_songs", "notes",
]);

/** Raw `<tag>…</tag>` fragments of unmodeled top-level elements (<style>, <pitch>, …). */
function extractExtras(xml: string, root: Record<string, unknown>): string[] {
  const extras: string[] = [];
  for (const key of Object.keys(root)) {
    if (key.startsWith("@_") || key.startsWith("#") || KNOWN_SONG_TAGS.has(key)) continue;
    const tag = key.replace(/[^\w-]/g, "");
    if (tag === "") continue;
    const m = new RegExp(`<${tag}(\\s[^>]*)?\\s*/>|<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`).exec(xml);
    if (m) extras.push(m[0]);
  }
  return extras;
}

/**
 * Parse an OpenSong song XML document into the canonical model:
 * metadata fields, lyrics -> offset-anchored sections, `<presentation>`
 * order -> the default arrangement.
 */
export function parseOpenSongSong(xml: string): SongParseResult {
  const warnings: string[] = [];
  let doc: unknown;
  try {
    doc = parseXml(xml);
  } catch (e) {
    throw new Error(`Invalid OpenSong XML: ${(e as Error).message}`);
  }
  const root = asRecord(asRecord(doc)["song"]);
  if (Object.keys(root).length === 0) {
    throw new Error("Invalid OpenSong song: no <song> root element");
  }

  const { sections, warnings: lyricWarnings } = parseOpenSongLyrics(
    textOf(root["lyrics"]),
  );
  warnings.push(...lyricWarnings);

  const capoRaw = textOf(root["capo"]).trim();
  const capoNum = capoRaw === "" ? NaN : Number.parseInt(capoRaw, 10);
  const capo = Number.isNaN(capoNum) ? null : capoNum;
  // <capo print="true|false">: gates the capo chord row + "Capo N" header in
  // OpenSong's print; GetValueB treats a missing/empty attr as false.
  const capoPrint = capo === null ? null : attrOf(root["capo"], "print") === "true";

  // <presentation> "V1 C V2 C" -> default arrangement sequence. A token can be
  // a section label ("C") or label+verse prefix ("V1" -> section V, prefix 1).
  const presentation = asString(root["presentation"]).trim();
  const sequence: { sectionIndex: number; repeats: number; prefix: string | null }[] = [];
  if (presentation !== "") {
    for (const tag of presentation.split(/\s+/)) {
      let idx = sections.findIndex((s) => s.label === tag);
      let prefix: string | null = null;
      if (idx === -1) {
        const m = /^([A-Za-z]+)(\d+)$/.exec(tag);
        if (m) {
          idx = sections.findIndex((s) => s.label === m[1]);
          if (idx !== -1) prefix = m[2]!;
        }
      }
      if (idx === -1) {
        warnings.push(`presentation references unknown section "${tag}"; skipped`);
        continue;
      }
      sequence.push({ sectionIndex: idx, repeats: 1, prefix });
    }
  } else {
    // Empty <presentation>: OpenSong's LyricsToSections order expands each
    // verse prefix as its own slide node ("V1 V2 C"), not one whole section.
    sections.forEach((s, idx) => {
      const prefixes: string[] = [];
      for (const l of s.lines) {
        if (l.kind === "lyric" && l.prefix !== null && !prefixes.includes(l.prefix)) {
          prefixes.push(l.prefix);
        }
      }
      if (prefixes.length > 0) {
        prefixes.forEach((prefix) => sequence.push({ sectionIndex: idx, repeats: 1, prefix }));
      } else {
        sequence.push({ sectionIndex: idx, repeats: 1, prefix: null });
      }
    });
  }

  const arrangements: ParsedArrangement[] = [
    {
      name: "Default",
      key: str(root["key"]),
      tempo: str(root["tempo"]),
      timeSignature: str(root["timesig"]) ?? str(root["time_sig"]),
      capo,
      capoPrint,
      notes: null,
      sequence,
    },
  ];

  const author = asString(root["author"]).trim();

  return {
    song: {
      title: asString(root["title"]).trim(),
      authors: author === "" ? [] : [author],
      copyright: str(root["copyright"]),
      ccliNumber: str(root["ccli"]),
      defaultKey: str(root["key"]),
      tempo: str(root["tempo"]),
      timeSignature: str(root["timesig"]) ?? str(root["time_sig"]),
      aka: str(root["aka"]),
      keyLine: str(root["key_line"]),
      theme: str(root["theme"]),
      secondaryTheme: str(root["alttheme"]),
      folder: null,
      userFields: {
        user1: asString(root["user1"]),
        user2: asString(root["user2"]),
        user3: asString(root["user3"]),
      },
      background: str(root["background"]),
      backgrounds: parseBackgrounds(root["backgrounds"]),
      notes: str(root["notes"]),
      hymnNumber: str(root["hymn_number"]),
      presentationRaw: presentation === "" ? null : presentation,
      linkedSongs: asString(root["linked_songs"])
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      extras: extractExtras(xml, root),
      sections,
      arrangements,
    },
    warnings,
  };
}

/** Assign canonical ids to a parsed song and its nested objects. */
export function materializeSong(parsed: ParsedSong, ids: IdGenerator): Song {
  const sectionIds = parsed.sections.map(() => ids.next() as SongSection["id"]);
  return {
    ...parsed,
    id: ids.next() as Song["id"],
    sections: parsed.sections.map((s, i) => ({ ...s, id: sectionIds[i]! })),
    backgrounds: parsed.backgrounds === null ? null : {
      resize: parsed.backgrounds.resize,
      keepAspect: parsed.backgrounds.keepAspect,
      link: parsed.backgrounds.link,
      asText: parsed.backgrounds.asText,
      items: parsed.backgrounds.items.map((b) => ({
        verse: b.verse,
        key: b.key ?? null,
        filename: b.filename,
      })),
    },
    arrangements: parsed.arrangements.map((a) => ({
      ...a,
      id: ids.next() as SongArrangement["id"],
      sequence: a.sequence.map((as) => ({
        id: ids.next() as SongArrangement["sequence"][number]["id"],
        sectionId: sectionIds[as.sectionIndex]!,
        repeats: as.repeats,
        prefix: as.prefix,
      })),
    })),
    revision: {
      id: ids.next() as Song["revision"]["id"],
      parentId: null,
      origin: "opensong-import",
      createdAt: new Date().toISOString(),
    },
  };
}
