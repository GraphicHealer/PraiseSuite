import type { BibleId } from "../../ids.js";

export interface BibleBook {
  /** Canonical book number (1 = Genesis). */
  number: number;
  name: string;
  abbrev: string | null;
  /** chapters[c-1][v-1] = verse text. */
  chapters: string[][];
}

export interface BibleTranslation {
  id: BibleId;
  name: string;
  abbreviation: string;
  language: string | null;
  /** License/copyright line shown on scripture output (required by providers). */
  copyright: string | null;
  /** Ordered canonically; books[i].number may have gaps for partial texts. */
  books: BibleBook[];
}

export interface ScriptureRef {
  book: number;
  chapter: number;
  startVerse: number;
  endVerse: number;
}

/** 66-book Protestant canon — lookup for reference parsing. */
export const BOOK_NAMES = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther",
  "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
  "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum",
  "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans",
  "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians",
  "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy",
  "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
] as const;

const BOOK_ALIASES: Record<string, number> = {};
BOOK_NAMES.forEach((name, i) => {
  BOOK_ALIASES[name.toLowerCase()] = i + 1;
  BOOK_ALIASES[name.toLowerCase().replace(/ /g, "")] = i + 1;
});
// Common abbreviations / alternates.
Object.assign(BOOK_ALIASES, {
  gen: 1, ex: 2, exo: 2, exod: 2, lev: 3, num: 4, deut: 5, deu: 5,
  josh: 6, jos: 6, judg: 7, jdg: 7, rut: 8,
  "1sam": 9, "2sam": 10, "1kgs": 11, "2kgs": 12, "1kin": 11, "2kin": 12,
  "1chr": 13, "2chr": 14, ezr: 15, neh: 16, est: 17, esth: 17,
  psa: 19, ps: 19, psalm: 19, prov: 20, pro: 20, eccl: 21, ecc: 21,
  song: 22, "songofsongs": 22, "songofsol": 22, "songofsolomon": 22, canticles: 22,
  isa: 23, jer: 24, lam: 25, ezek: 26, eze: 26, dan: 27,
  hos: 28, joe: 29, amo: 30, oba: 31, jon: 32, mic: 33, nah: 34,
  hab: 35, zeph: 36, zep: 36, hag: 37, zech: 38, zec: 38, mal: 39,
  matt: 40, mat: 40, mk: 41, mrk: 41, lk: 42, jn: 43, joh: 43,
  rom: 45, "1cor": 46, "2cor": 47, gal: 48, eph: 49, phil: 50, php: 50,
  col: 51, "1thess": 52, "2thess": 53, "1thes": 52, "2thes": 53,
  "1tim": 54, "2tim": 55, tit: 56, philem: 57, phlm: 57, phm: 57,
  heb: 58, jas: 59, jam: 59, "1pet": 60, "2pet": 61, "1jn": 62, "2jn": 63, "3jn": 64,
  jud: 65, rev: 66,
});

/** Resolve a book name/abbrev to its canonical number, or null. */
export function bookNumber(name: string): number | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, "");
  return BOOK_ALIASES[key] ?? BOOK_ALIASES[name.trim().toLowerCase()] ?? null;
}

/**
 * Parse "John 3:16", "Gen 1:1-3", "1 Cor 13:4-7", "Psalm 23" (whole chapter),
 * "Rom 8:28,30" is not supported — single contiguous ranges only.
 */
export function parseReference(text: string): ScriptureRef | null {
  const m = /^([1-3]?\s?[A-Za-z]+(?:\s+of\s+\w+)?)\s+(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/i.exec(text.trim());
  if (!m) return null;
  const book = bookNumber(m[1]!);
  if (book === null) return null;
  const chapter = Number.parseInt(m[2]!, 10);
  const startVerse = m[3] !== undefined ? Number.parseInt(m[3], 10) : 1;
  const endVerse = m[4] !== undefined ? Number.parseInt(m[4], 10) : startVerse;
  if (!Number.isFinite(chapter) || chapter < 1 || !Number.isFinite(startVerse) || startVerse < 1) return null;
  return { book, chapter, startVerse, endVerse: Math.max(startVerse, endVerse) };
}

/** "John 3:16-18" */
export function citation(ref: ScriptureRef): string {
  const name = BOOK_NAMES[ref.book - 1] ?? `Book ${ref.book}`;
  return ref.startVerse === ref.endVerse
    ? `${name} ${ref.chapter}:${ref.startVerse}`
    : `${name} ${ref.chapter}:${ref.startVerse}-${ref.endVerse}`;
}

export function bookOf(bible: BibleTranslation, book: number): BibleBook | null {
  return bible.books.find((b) => b.number === book) ?? null;
}

/** Validate a ref against a bible; returns the clamped ref or null. */
export function clampReference(bible: BibleTranslation, ref: ScriptureRef): ScriptureRef | null {
  const b = bookOf(bible, ref.book);
  const chapter = b?.chapters[ref.chapter - 1];
  if (!chapter || chapter.length === 0) return null;
  const start = Math.min(ref.startVerse, chapter.length);
  const end = ref.endVerse === 0 ? chapter.length : Math.min(ref.endVerse, chapter.length);
  return { ...ref, startVerse: start, endVerse: end };
}

/** Verse texts for a (clamped) reference. */
export function passage(bible: BibleTranslation, ref: ScriptureRef): string[] {
  const clamped = clampReference(bible, ref);
  if (!clamped) return [];
  const chapter = bookOf(bible, ref.book)!.chapters[clamped.chapter - 1]!;
  return chapter.slice(clamped.startVerse - 1, clamped.endVerse);
}
