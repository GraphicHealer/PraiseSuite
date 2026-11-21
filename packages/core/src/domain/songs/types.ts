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
 * Break before this line (SongML AdjustSlideBreaks): "slide" = blank-line
 * boundary (only when blank_is_slide_change is on); "bar" = || boundary
 * (always a new slide); "inline" = | mid-line split — a new line WITHIN the
 * same slide.
 */
export type LineBreak = "none" | "slide" | "inline" | "bar";

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
  /**
   * Verse-number prefix filter (OpenSong presentation "V1" -> section "V",
   * prefix "1"). When set, only lines whose `prefix` matches are presented.
   */
  prefix: string | null;
}

export interface SongArrangement {
  id: ArrangementId;
  name: string;
  key: string | null;
  tempo: string | null;
  timeSignature: string | null;
  capo: number | null;
  /** OpenSong <capo print="..."> — whether print output shows the capo chord row. */
  capoPrint?: boolean | null | undefined;
  /** OpenSong capo/@sharp — capo chords spelled with sharps (true) or flats
   *  (false); null/absent falls back to the global accidental preference. */
  capoSharp?: boolean | null | undefined;
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
  /** Library folder this song belongs to (OpenSong Songs/ subfolders; from import path). */
  folder: string | null;
  /** User-defined fields; labels come from installation settings (OpenSong user1-3). */
  userFields: { user1: string; user2: string; user3: string };
  sections: SongSection[];
  arrangements: SongArrangement[];
  /** Song-level background media reference (OpenSong `background` path or a storage key). */
  background: string | null;
  /**
   * Verse-specific backgrounds (OpenSong `<backgrounds>`): per-section images
   * cycled across the section's slide slices, with fit/link/as-text flags.
   */
  backgrounds: SongBackgrounds | null;
  notes: string | null;
  /** OpenSong hymn_number (searchable, subtitle option, print header). */
  hymnNumber: string | null;
  /**
   * The source `<presentation>` order verbatim, or null when the file had
   * none/empty — needed to distinguish "explicit order equal to the default"
   * from "no order" on export.
   */
  presentationRaw: string | null;
  /** OpenSong linked_songs — related songs offered when adding to a set. */
  linkedSongs: string[];
  /**
   * Raw `<style>…</style>` element for a song-level style override
   * (OpenSong's "Override Style" checkbox — the element's existence IS the
   * flag). Kept verbatim for lossless round-trips; parsed via
   * parseStyleOverride when the presentation plan applies it.
   */
  styleXml: string | null;
  /**
   * Media storage key for an image embedded in the song `<style><background>`
   * (base64 text). Registered at import so the styled background renders;
   * the raw XML keeps its embedded data for export fidelity.
   */
  styleBackgroundKey: string | null;
  /**
   * Raw XML fragments of top-level song elements PraiseSuite does not model
   * (e.g. <pitch>, <restrictions>) — preserved verbatim so a
   * PS→OpenSong round trip never loses data.
   */
  extras: string[];
}

export interface SongBackgrounds {
  /** OpenSong @resize: "screen" | "body" | "" (no resize). */
  resize: string;
  keepAspect: boolean;
  /** Store filename links instead of embedded image data (OpenSong @link). */
  link: boolean;
  /** Show the background image INSTEAD of the slide text (OpenSong @background_as_text). */
  asText: boolean;
  items: SongBackgroundItem[];
}

export interface SongBackgroundItem {
  /** Section label this applies to (OpenSong @verse, e.g. "V1", "C"). */
  verse: string;
  /** Media storage key (image imported/uploaded), or null when only linked. */
  key: string | null;
  /** Original filename — kept for link mode and export round-trips. */
  filename: string | null;
}
