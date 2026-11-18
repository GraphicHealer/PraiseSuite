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

  const capoRaw = asString(root["capo"]).trim();
  const capoNum = capoRaw === "" ? NaN : Number.parseInt(capoRaw, 10);
  const capo = Number.isNaN(capoNum) ? null : capoNum;
  void attrOf(root["capo"], "print"); // print preference; not yet modeled

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
    sections.forEach((_s, idx) => sequence.push({ sectionIndex: idx, repeats: 1, prefix: null }));
  }

  const arrangements: ParsedArrangement[] = [
    {
      name: "Default",
      key: str(root["key"]),
      tempo: str(root["tempo"]),
      timeSignature: str(root["timesig"]),
      capo,
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
      timeSignature: str(root["timesig"]),
      aka: str(root["aka"]),
      keyLine: str(root["key_line"]),
      theme: str(root["theme"]),
      secondaryTheme: str(root["alttheme"]),
      userFields: {
        user1: asString(root["user1"]),
        user2: asString(root["user2"]),
        user3: asString(root["user3"]),
      },
      background: str(root["background"]),
      backgrounds: parseBackgrounds(root["backgrounds"]),
      notes: null,
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
