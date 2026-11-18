/**
 * Canonical chord representation (TAS 8.2).
 * Structured so transposition/enharmonic logic works on parts, while `raw`
 * preserves anything the parser could not decompose (never discarded).
 */
export interface Chord {
  /** Note letter including accidental, e.g. "C", "F#", "Bb". */
  root: string;
  /** Quality token, e.g. "m", "maj7", "sus4", "dim", "aug", "" for major. */
  quality: string;
  extensions: string[];
  alterations: string[];
  /** Alternate bass note for slash chords. */
  bass: string | null;
  /** Preferred display string (may differ from recomposed name for custom chords). */
  display: string;
  /** Original source text when it could not be fully decomposed. */
  raw: string | null;
}
