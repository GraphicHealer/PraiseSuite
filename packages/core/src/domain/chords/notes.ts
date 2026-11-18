/** Note <-> semitone helpers and enharmonic spelling. */

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

const LETTER_BASE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Keys whose signatures (and conventional spellings) use flats. */
const FLAT_KEYS = new Set([
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
  "Gb",
  "Cb",
  "Dm",
  "Gm",
  "Cm",
  "Fm",
  "Bbm",
  "Ebm",
  "Abm",
]);

/** Parse a note name ("C", "F#", "Bb", unicode accidentals tolerated) to a semitone 0-11, or null. */
export function noteToSemitone(note: string): number | null {
  if (note.length === 0) return null;
  const letter = note[0]!.toUpperCase();
  const base = LETTER_BASE[letter];
  if (base === undefined) return null;
  let semitone = base;
  for (const ch of note.slice(1)) {
    if (ch === "#" || ch === "♯") semitone += 1;
    else if (ch === "b" || ch === "♭") semitone -= 1;
    else return null; // unexpected character
  }
  return ((semitone % 12) + 12) % 12;
}

/** Spell a semitone as a note name, preferring flats or sharps. */
export function semitoneToNote(semitone: number, preferFlats: boolean): string {
  const index = ((semitone % 12) + 12) % 12;
  return preferFlats ? FLAT_NAMES[index]! : SHARP_NAMES[index]!;
}

/** True when the key signature (e.g. "Eb", "Gm") conventionally spells with flats. */
export function keyPrefersFlats(key: string | null | undefined): boolean {
  if (!key) return false;
  return FLAT_KEYS.has(key.trim());
}
