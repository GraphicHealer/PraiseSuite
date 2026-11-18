import type { Song } from "../../domain/songs/types.js";
import type { ParsedSong } from "./song.js";

export type DuplicateReason =
  | "same-ccli"
  | "same-title-author"
  | "similar-lyrics";

export interface DuplicateMatch {
  /** Index into the incoming batch. */
  incomingIndex: number;
  /** Existing song id the match was found against, or index of another incoming song ("incoming:3"). */
  existingRef: string;
  reasons: DuplicateReason[];
  /** 0-1 confidence estimate. */
  confidence: number;
}

/** Normalize lyric text for comparison: letters/digits only, single-spaced, lowercase. */
export function normalizeLyrics(sections: { lines: { kind: string; text: string }[] }[]): string {
  return sections
    .flatMap((s) => s.lines.filter((l) => l.kind === "lyric").map((l) => l.text))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word n-gram set for similarity comparison (TAS 9.7 hashed word shingles). */
export function wordShingles(text: string, n = 4): Set<string> {
  const words = text.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) {
    out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface ExistingSongInfo {
  id: string;
  title: string;
  authors: string[];
  ccliNumber: string | null;
  normalizedLyrics: string;
}

export function existingInfo(song: Song): ExistingSongInfo {
  return {
    id: song.id,
    title: song.title,
    authors: song.authors,
    ccliNumber: song.ccliNumber,
    normalizedLyrics: normalizeLyrics(song.sections),
  };
}

function norm(s: string | null): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Duplicate detection per PRD 5.3 / TAS 9.7: identifiers, normalized
 * title+author, CCLI numbers, and lyric-shingle similarity.
 */
export function detectDuplicates(
  incoming: ParsedSong[],
  existing: ExistingSongInfo[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const shingles = existing.map((e) => wordShingles(e.normalizedLyrics));

  incoming.forEach((song, idx) => {
    const incLyrics = normalizeLyrics(song.sections);
    const incShingles = wordShingles(incLyrics);
    const candidates = existing.map((e, i) => ({
      info: e,
      similarity: jaccard(incShingles, shingles[i]!),
    }));

    for (const { info, similarity } of candidates) {
      const reasons: DuplicateReason[] = [];
      if (song.ccliNumber && song.ccliNumber === info.ccliNumber)
        reasons.push("same-ccli");
      if (
        norm(song.title) === norm(info.title) &&
        norm(song.authors.join(";")) === norm(info.authors.join(";"))
      )
        reasons.push("same-title-author");
      if (similarity >= 0.7) reasons.push("similar-lyrics");

      if (reasons.length > 0) {
        matches.push({
          incomingIndex: idx,
          existingRef: info.id,
          reasons,
          confidence: reasons.includes("same-ccli")
            ? 0.95
            : Math.max(
                reasons.includes("same-title-author") ? 0.9 : 0,
                similarity,
              ),
        });
      }
    }
  });
  return matches;
}
