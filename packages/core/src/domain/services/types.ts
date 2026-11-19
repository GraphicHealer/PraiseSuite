import type {
  ArrangementId,
  MediaAssetId,
  ServiceId,
  ServiceItemId,
  SongId,
} from "../../ids.js";
import type { Revisioned } from "../revision.js";

export type ServiceItemKind =
  | "song"
  | "scripture"
  | "custom-slides"
  | "announcement"
  | "media"
  | "note"
  /** OpenSong <slide_group type="style"> — mid-set style change (no slides). */
  | "style";

/**
 * A single item in a service plan. References reusable content by ID but keeps
 * its own ordering and per-service configuration (PRD 7.2).
 */
export interface ServiceItem {
  id: ServiceItemId;
  kind: ServiceItemKind;
  songId: SongId | null;
  arrangementId: ArrangementId | null;
  mediaAssetId: MediaAssetId | null;
  title: string;
  subtitle: string | null;
  notes: string | null;
  /** Inline content for custom/scripture/announcement items. */
  slides: { body: string }[];
  /** Loop timing for announcement groups (seconds; 0 = no loop). */
  loopSeconds: number;
  config: Record<string, unknown>;
}

/** A plan, not the live state of a presentation (PRD 8.1). */
export interface Service extends Revisioned {
  id: ServiceId;
  name: string;
  date: string | null; // ISO date
  description: string | null;
  items: ServiceItem[];
}
