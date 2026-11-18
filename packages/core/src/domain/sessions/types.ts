import type {
  ArrangementId,
  ArrangementSectionId,
  DeviceId,
  OutputId,
  ServiceId,
  ServiceItemId,
  SessionId,
  SongId,
  SongSectionId,
} from "../../ids.js";

/**
 * Shared musical position (TAS 5.2). Outputs never sync by slide number —
 * each output maps this position to its own rendering.
 */
export interface MusicalPosition {
  sessionId: SessionId;
  serviceItemId: ServiceItemId | null;
  songId: SongId | null;
  arrangementId: ArrangementId | null;
  sectionId: SongSectionId | null;
  sectionInstanceId: ArrangementSectionId | null;
  /** Index within the section (line/slice), for outputs that sub-divide a section. */
  positionWithinSection: number;
}

export type SessionStatus = "preparing" | "live" | "suspended" | "ended";

export type NavigationMode = "follow" | "independent" | "hybrid";

/** Output mode (OpenSong initial_mode N/B/L + freeze). */
export type OutputMode = "normal" | "blank" | "logo" | "freeze";

export type OutputType =
  | "projector"
  | "confidence"
  | "stage"
  | "musician"
  | "browser-receiver"
  | "native-display";

export interface PresentationOutput {
  id: OutputId;
  sessionId: SessionId;
  type: OutputType;
  navigationMode: NavigationMode;
  deviceId: DeviceId | null;
  config: Record<string, unknown>;
}

export interface PresentationSession {
  id: SessionId;
  serviceId: ServiceId | null;
  name: string;
  status: SessionStatus;
  position: MusicalPosition;
  /** Screen blanked (black) while position is retained for recovery. */
  blanked: boolean;
  /** Output mode — blank/logo/freeze overlay the current slide. */
  mode: OutputMode;
  /** Alert message overlaid on all outputs, or null. */
  alert: string | null;
  /** jti of the token currently holding control, or null when free (TAS 13.4). */
  controlOwner: string | null;
  createdAt: string; // ISO 8601
  lastActivityAt: string; // ISO 8601
}
