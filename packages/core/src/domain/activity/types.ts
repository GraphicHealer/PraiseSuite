/**
 * Activity log action codes — same numbering as OpenSong's LogEntry
 * (kSongCreated..kSongCopied) so imported/exported logs stay compatible.
 */
export const ACTIVITY = {
  created: 1,
  deleted: 2,
  modified: 3,
  moved: 4,
  presented: 5,
  printed: 6,
  copied: 8,
} as const;

export type ActivityAction = (typeof ACTIVITY)[keyof typeof ACTIVITY];

export const ACTIVITY_NAMES: Record<number, string> = {
  1: "Created",
  2: "Deleted",
  3: "Modified",
  4: "Moved",
  5: "Presented",
  6: "Printed",
  8: "Copied",
};

/** One log row (OpenSong <entryN>): when + what + which song. */
export interface ActivityEntry {
  id: number;
  /** ISO datetime (OpenSong stores <date> + <time> separately). */
  at: string;
  action: number;
  songId: string | null;
  filename: string | null;
  title: string;
  authors: string[];
  ccliNumber: string | null;
  hasChords: boolean;
}
