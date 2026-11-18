import { formatChord } from "./parse.js";
import { keyPrefersFlats, noteToSemitone, semitoneToNote } from "./notes.js";
import type { Chord } from "./types.js";
import type { ChordAnnotation, LyricLine, SongSection } from "../songs/types.js";

export interface TransposeOptions {
  /** Target key (e.g. "Eb") drives flat/sharp spelling. */
  targetKey?: string | null;
  preferFlats?: boolean;
}

function preference(options: TransposeOptions | undefined, semitones: number): boolean {
  if (options?.preferFlats !== undefined) return options.preferFlats;
  if (options?.targetKey != null) return keyPrefersFlats(options.targetKey);
  // No key context: transposing down spells flats, up spells sharps.
  return semitones < 0;
}

/**
 * Transpose a chord by `semitones`. Root and bass move; the suffix
 * (quality/extensions/alterations) is unchanged. Unparseable chords
 * (raw set) are returned untouched.
 */
export function transposeChord(
  chord: Chord,
  semitones: number,
  options?: TransposeOptions,
): Chord {
  if (chord.raw !== null || chord.root === "" || semitones === 0) return chord;
  const flats = preference(options, semitones);
  const root = semitoneToNote(
    (noteToSemitone(chord.root) ?? 0) + semitones,
    flats,
  );
  const bass =
    chord.bass === null
      ? null
      : semitoneToNote((noteToSemitone(chord.bass) ?? 0) + semitones, flats);
  const next: Chord = { ...chord, root, bass };
  return { ...next, display: formatChord(next) };
}

/** Semitone distance between two keys ("C" -> "Eb" = +3), or null if either is invalid. */
export function keyDistance(from: string, to: string): number | null {
  const a = noteToSemitone(from);
  const b = noteToSemitone(to);
  if (a === null || b === null) return null;
  return (((b - a) % 12) + 12) % 12;
}

/**
 * The chord a player fingers when using a capo: sounding pitch shifted
 * down by the capo fret (capo 2 in D = C shapes).
 */
export function capoFingering(chord: Chord, capo: number): Chord {
  return transposeChord(chord, -capo, { preferFlats: false });
}

export function transposeAnnotations(
  annotations: ChordAnnotation[],
  semitones: number,
  options?: TransposeOptions,
): ChordAnnotation[] {
  return annotations.map((a) => ({
    ...a,
    chord: transposeChord(a.chord, semitones, options),
  }));
}

export function transposeLine(
  line: LyricLine,
  semitones: number,
  options?: TransposeOptions,
): LyricLine {
  return { ...line, chords: transposeAnnotations(line.chords, semitones, options) };
}

export function transposeSection(
  section: SongSection,
  semitones: number,
  options?: TransposeOptions,
): SongSection {
  return { ...section, lines: section.lines.map((l) => transposeLine(l, semitones, options)) };
}
