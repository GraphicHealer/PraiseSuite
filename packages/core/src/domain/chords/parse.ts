import type { Chord } from "./types.js";

const ROOT_RE = /^([A-Ga-g])([#b♯♭]*)/;
const BASS_RE = /\/([A-Ga-g][#b♯♭]*)\s*$/;
// Longest-first so "maj" isn't eaten as "m"+"aj".
const QUALITY_TOKEN_RE = /^(maj|min|dim|aug|sus\d*|add\d*|m|M|°|ø|Δ)/;
const ALTERATION_RE = /^([#b♯♭]\d+|(?:no|omit|add)\d*\([^)]*\)|\([^)]*\)|no\d+|omit\d+)/;
const EXTENSION_RE = /^(\d+(?:sus\d*)?|add\d+)/;

/**
 * Parse chord text into the canonical structured form (TAS 8.2).
 * Anything that does not fit the grammar is preserved verbatim in `raw`
 * and echoed back by formatChord via `display` — never discarded.
 */
export function parseChord(text: string): Chord {
  const trimmed = text.trim();
  const fail = (): Chord => ({
    root: "",
    quality: "",
    extensions: [],
    alterations: [],
    bass: null,
    display: trimmed,
    raw: trimmed,
  });
  if (trimmed === "") return fail();

  const rootMatch = ROOT_RE.exec(trimmed);
  if (!rootMatch) return fail();

  const root = rootMatch[1]!.toUpperCase() + (rootMatch[2] ?? "");
  let rest = trimmed.slice(rootMatch[0].length).trim();

  let bass: string | null = null;
  const bassMatch = BASS_RE.exec(rest);
  if (bassMatch) {
    bass = bassMatch[1]![0]!.toUpperCase() + bassMatch[1]!.slice(1);
    rest = rest.slice(0, rest.length - bassMatch[0].length).trim();
  }

  let quality = "";
  const extensions: string[] = [];
  const alterations: string[] = [];

  const qm = QUALITY_TOKEN_RE.exec(rest);
  if (qm) {
    quality = qm[1]!;
    rest = rest.slice(qm[0].length);
  }
  while (rest.length > 0) {
    const am = ALTERATION_RE.exec(rest);
    if (am) {
      alterations.push(am[1]!);
      rest = rest.slice(am[0].length);
      continue;
    }
    const em = EXTENSION_RE.exec(rest);
    if (em) {
      extensions.push(em[1]!);
      rest = rest.slice(em[0].length);
      continue;
    }
    // Unrecognized trailing text — keep it as an alteration so nothing is lost.
    alterations.push(rest);
    rest = "";
  }

  return {
    root,
    quality,
    extensions,
    alterations,
    bass,
    display: trimmed,
    raw: null,
  };
}

/** Recompose the display string from structured parts (TAS 8.2 display_name). */
export function formatChord(chord: Chord): string {
  if (chord.raw !== null || chord.root === "") return chord.display;
  const suffix =
    chord.quality + chord.extensions.join("") + chord.alterations.join("");
  return chord.root + suffix + (chord.bass !== null ? `/${chord.bass}` : "");
}
