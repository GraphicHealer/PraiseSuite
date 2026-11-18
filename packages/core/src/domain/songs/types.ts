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

export type LyricLineKind = "lyric" | "comment" | "directive";

/**
 * Break before this line: "slide" = blank line / || boundary (new slide);
 * "inline" = | mid-line split (continues the written line, new slide).
 */
export type LineBreak = "none" | "slide" | "inline";

export interface LyricLine {
  text: string;
  chords: ChordAnnotation[];
  breakBefore: LineBreak;
  /** Verse/line-number prefix column (OpenSong `1`-`9` line prefix). */
  prefix: string | null;
  kind: LyricLineKind;
  /** 1 or 2 within a bilingual section; null otherwise. */
  lang: 1 | 2 | null;
}

export interface SongSection {
  id: SongSectionId;
  type: SectionType;
  /** Display label as written in the source, e.g. "V1", "C", "Bridge". */
  label: string;
  lines: LyricLine[];
  /** Section options from `[X](opt;k=v)` syntax; valueless flags map to null (e.g. L). */
  options: Record<string, string | null>;
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
  /** Alternate titles / "also known as" (OpenSong `aka`). */
  aka: string | null;
  /** Free-form key line (OpenSong `key_line`, e.g. "Play in C with capo 3"). */
  keyLine: string | null;
  /** Primary theme/category (OpenSong `theme`). */
  theme: string | null;
  /** Secondary theme/category (OpenSong `alttheme`). */
  secondaryTheme: string | null;
  /** User-defined fields; labels come from installation settings (OpenSong user1-3). */
  userFields: { user1: string; user2: string; user3: string };
  sections: SongSection[];
  arrangements: SongArrangement[];
  /** Song-level background media reference (OpenSong `background` path or a storage key). */
  background: string | null;
  notes: string | null;
}
