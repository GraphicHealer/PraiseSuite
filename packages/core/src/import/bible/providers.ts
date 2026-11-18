import type { BibleBook, BibleTranslation } from "../../domain/bible/types.js";
import type { BibleId } from "../../ids.js";

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/* ---------- API.Bible (rest.api.bible — American Bible Society) ---------- */

/** Normalize `GET /v1/bibles` → translation summaries for the picker. */
export function apiBibleList(json: unknown): { id: string; name: string; abbreviation: string }[] {
  return arr(rec(json)["data"]).map((b) => {
    const r = rec(b);
    return { id: str(r["id"]), name: str(r["name"] ?? r["nameLocal"]), abbreviation: str(r["abbreviation"]) };
  });
}

/**
 * Verse text from API.Bible chapter HTML: verses are marked by
 * `<span data-number="N" class="v">N</span>`; split on those markers and
 * strip remaining tags.
 */
export function apiBibleChapterVerses(contentHtml: string): string[] {
  const parts = contentHtml.split(/<span[^>]*data-number="(\d+)"[^>]*>[^<]*<\/span>/);
  // parts: [pre, "1", text1, "2", text2, ...]
  const verses: string[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const num = Number.parseInt(parts[i]!, 10);
    const text = parts[i + 1]!
      .replace(/<[^>]+>/g, " ")
      .replace(/&\w+;/g, (e) => e) // entities left for the caller's XML layer if needed
      .replace(/\s+/g, " ")
      .trim();
    while (verses.length < num - 1) verses.push("");
    verses[num - 1] = text;
  }
  return verses;
}

/** Assemble fetched books+chapters into a canonical translation. */
export function apiBibleTranslation(
  meta: Record<string, unknown>,
  booksJson: unknown[],
  chapters: Record<string, string[]>, // chapterId -> verse texts
  id: BibleId,
): BibleTranslation {
  const books: BibleBook[] = booksJson.flatMap((bj) =>
    arr(rec(bj)["data"]).map((b) => {
      const r = rec(b);
      const number = Number.parseInt(str(r["number"]).replace(/\D/g, "") || "0", 10);
      const chapterIds = arr(r["chapters"]).map((c) => str(rec(c)["id"]));
      const chapterVerses = chapterIds.map((cid) => chapters[cid] ?? []);
      return {
        number: Number.isFinite(number) && number > 0 ? number : books.length + 1,
        name: str(r["name"] ?? r["nameLong"]),
        abbrev: str(r["abbreviation"]) || null,
        chapters: chapterVerses,
      };
    }),
  );
  return {
    id,
    name: str(meta["name"] ?? meta["nameLocal"]) || "Bible",
    abbreviation: str(meta["abbreviation"]) || "Bible",
    language: str(rec(meta["language"])["name"]) || null,
    copyright: str(meta["copyright"]) || null,
    books,
  };
}

/* ---------- HelloAO Free Use Bible API (bible.helloao.org) ---------- */

/** Normalize `available_translations.json`. */
export function helloAoList(json: unknown): { id: string; name: string; abbreviation: string }[] {
  return arr(rec(json)["translations"]).map((t) => {
    const r = rec(t);
    return { id: str(r["id"]), name: str(r["englishName"] ?? r["name"]), abbreviation: str(r["shortName"] ?? r["id"]) };
  });
}

/** Extract verse texts from a HelloAO chapter document. */
export function helloAoChapterVerses(json: unknown): string[] {
  const content = arr(rec(rec(json)["chapter"])["content"]);
  const verses: string[] = [];
  for (const block of content) {
    const b = rec(block);
    if (b["type"] !== "verse") continue;
    const num = Number.parseInt(str(b["number"]), 10);
    const text = arr(b["content"])
      .map((p) => (typeof p === "string" ? p : str(rec(p)["text"] ?? rec(p)["verseText"])))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (num >= 1) {
      while (verses.length < num - 1) verses.push("");
      verses[num - 1] = text;
    }
  }
  return verses;
}
