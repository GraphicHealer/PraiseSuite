import type { RevisionId } from "../ids.js";

/**
 * Revision metadata carried by every synchronizable entity.
 * Timestamps are informational only — conflict resolution is driven by the
 * parent chain (TAS 10.3), never by comparing createdAt values.
 */
export interface Revision {
  id: RevisionId;
  parentId: RevisionId | null;
  /** Device or author that produced this revision. */
  origin: string;
  createdAt: string; // ISO 8601
}

export interface Revisioned {
  revision: Revision;
}
