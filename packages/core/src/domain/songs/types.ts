import type {
  ArrangementId,
  ArrangementSectionId,
  SongId,
  SongSectionId,
} from "../../ids.js";
import type { Chord } from "../chords/types.js";
import type { Revisioned } from "../revision.js";

export type SectionType =
  | "verse"
  | "chorus"
  | "prechorus"
  | "bridge"
  | "tag"
  | "intro"
  | "outro"
  | "instrumental"
  | "other";

/** A chord anchored at a character offset into the owning line's lyric text (TAS 8.4). */
export interface ChordAnnotation {
  offset: number;
  chord: Chord;
}

export interface LyricLine {
  text: string;
  chords: ChordAnnotation[];
  /** Explicit slide break before this line (OpenSong `|`/`||` markers). */
  breakBefore: boolean;
}

export interface SongSection {
  id: SongSectionId;
  type: SectionType;
  /** Display label, e.g. "V1", "Chorus", "Bridge 2". */
  label: string;
  lines: LyricLine[];
}

/**
 * An occurrence of a reusable section inside an arrangement.
 * `id` is the section-instance ID used for musical-position sync (TAS 5.3).
 */
export interface ArrangementSection {
  id: ArrangementSectionId;
  sectionId: SongSectionId;
  repeats: number;
}

export interface SongArrangement {
  id: ArrangementId;
  name: string;
  key: string | null;
  tempo: string | null;
  timeSignature: string | null;
  capo: number | null;
  notes: string | null;
  sequence: ArrangementSection[];
}

export interface Song extends Revisioned {
  id: SongId;
  title: string;
  authors: string[];
  copyright: string | null;
  ccliNumber: string | null;
  defaultKey: string | null;
  tempo: string | null;
  timeSignature: string | null;
  /** Primary theme/category (OpenSong `theme`). */
  theme: string | null;
  /** Secondary theme/category (OpenSong `alttheme`). */
  secondaryTheme: string | null;
  /** User-defined fields; labels come from installation settings (OpenSong user1-3). */
  userFields: { user1: string; user2: string; user3: string };
  sections: SongSection[];
  arrangements: SongArrangement[];
  notes: string | null;
}
