import type { BibleBook, BibleTranslation } from "../../domain/bible/types.js";
import { BOOK_NAMES } from "../../domain/bible/types.js";
import type { BibleId } from "../../ids.js";
import { asRecord, asString, attrOf, parseXml, textOf } from "../opensong/xml.js";

function list(el: unknown): Record<string, unknown>[] {
  if (el === undefined || el === null) return [];
  return Array.isArray(el) ? (el as Record<string, unknown>[]) : [el as Record<string, unknown>];
}

/**
 * Parse an OpenSong Bible XML file into a canonical translation.
 *
 * OpenSong format:      <bible><b n="1" name="…"> <c n="1"> <v n="1">text</v>…
 * Also accepts Zefania: <XMLBIBLE><BIBLEBOOK bnumber="1" bname="…">
 *                       <CHAPTER cnumber="1"><VERS vnumber="1">text</VERS>…
 *
 * Verse text may contain <t> segments (OpenSong joins them with "-"); any
 * child markup is flattened to text.
 */
export function parseOpenSongBible(xml: string, id: BibleId): BibleTranslation {
  const doc = asRecord(parseXml(xml));
  const root = asRecord(doc["bible"] ?? doc["XMLBIBLE"]);
  const bookEls = list(root["b"] ?? root["BIBLEBOOK"]);
  if (bookEls.length === 0) throw new Error("Invalid Bible XML: no <b>/<BIBLEBOOK> elements");

  const books: BibleBook[] = bookEls.map((b, i) => {
    const num = Number.parseInt(attrOf(b, "n") || attrOf(b, "bnumber") || String(i + 1), 10);
    const chapterEls = list(b["c"] ?? b["CHAPTER"]);
    // Sparse-safe: index by declared chapter/verse numbers, not parse order.
    const chapters: string[][] = [];
    for (const [ci, c] of chapterEls.entries()) {
      const cnum = Number.parseInt(attrOf(c, "n") || attrOf(c, "cnumber") || String(ci + 1), 10);
      const verses: string[] = [];
      list(c["v"] ?? c["VERS"]).forEach((v, vi) => {
        // Verse text: element text, or <t> segments joined with "-".
        const rec = asRecord(v);
        const text = rec["t"] !== undefined
          ? list(rec["t"]).map((t) => textOf(t).trim()).join("-")
          : textOf(v).replace(/\s+/g, " ").trim();
        const vnum = Number.parseInt(attrOf(v, "n") || attrOf(v, "vnumber") || String(vi + 1), 10);
        verses[(Number.isFinite(vnum) ? vnum : vi + 1) - 1] = text;
      });
      chapters[(Number.isFinite(cnum) ? cnum : ci + 1) - 1] = verses;
    }
    return {
      number: num,
      name: asString(b["name"] ?? attrOf(b, "name") ?? attrOf(b, "bname") ?? "") || (BOOK_NAMES[num - 1] ?? `Book ${num}`),
      abbrev: asString(b["abbrev"] ?? attrOf(b, "abbrev") ?? "") || null,
      chapters,
    };
  });
  return {
    id,
    name: asString(root["@_biblename"] ?? root["biblename"] ?? root["@_name"] ?? "") || "Imported Bible",
    abbreviation: asString(root["@_abbreviation"] ?? root["abbreviation"] ?? "") || "Bible",
    language: asString(root["@_language"] ?? "") || null,
    copyright: asString(root["copyright"] ?? root["@_copyright"] ?? "") || null,
    books,
  };
}
