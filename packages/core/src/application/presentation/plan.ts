import type { Service, ServiceItem } from "../../domain/services/types.js";
import type { Song, SongArrangement, SongSection } from "../../domain/songs/types.js";
import type { MusicalPosition } from "../../domain/sessions/types.js";
import type {
  ArrangementId,
  ArrangementSectionId,
  ServiceItemId,
  SessionId,
  SongId,
  SongSectionId,
} from "../../ids.js";

/**
 * One visible slide: a slice of lines within a section instance, or inline
 * content for non-song items. Positions address slices, never slide numbers
 * (TAS 5.2).
 */
export interface PlanSlide {
  serviceItemId: ServiceItemId;
  kind: ServiceItem["kind"];
  songId: SongId | null;
  arrangementId: ArrangementId | null;
  sectionId: SongSectionId | null;
  sectionInstanceId: ArrangementSectionId | null;
  /** Index of the slice within the section (lines grouped at slide breaks). */
  sliceIndex: number;
  title: string;
  lines: string[];
  /** Storage key for image/video media slides (kind === "media"). */
  mediaKey: string | null;
}

export interface PresentationPlan {
  slides: PlanSlide[];
  /** Index of the first slide for each service item (for jump menus). */
  itemStart: number[];
}

/** Lines -> slide slices: "slide" and "inline" breaks both start a new slice. */
function slicesOfSection(section: SongSection): string[][] {
  const slices: string[][] = [[]];
  for (const line of section.lines) {
    if (line.kind !== "lyric") continue;
    if (
      (line.breakBefore === "slide" || line.breakBefore === "inline") &&
      slices[slices.length - 1]!.length > 0
    )
      slices.push([]);
    slices[slices.length - 1]!.push(line.text);
  }
  while (slices.length > 1 && slices[slices.length - 1]!.length === 0) slices.pop();
  return slices.length === 0 ? [[]] : slices;
}

function resolveArrangement(song: Song, arrangementId: ArrangementId | null): SongArrangement | null {
  if (song.arrangements.length === 0) return null;
  if (arrangementId === null) return song.arrangements[0]!;
  return song.arrangements.find((a) => a.id === arrangementId) ?? song.arrangements[0]!;
}

/**
 * Flatten a service plan into its ordered slides. Song items expand through
 * the chosen arrangement's section sequence; other items render their
 * inline slides.
 */
export function buildPlan(
  service: Service,
  songsById: ReadonlyMap<SongId, Song>,
): PresentationPlan {
  const slides: PlanSlide[] = [];
  const itemStart: number[] = [];

  for (const item of service.items) {
    itemStart.push(slides.length);
    if (item.kind === "song" && item.songId !== null) {
      const song = songsById.get(item.songId);
      const arrangement = song ? resolveArrangement(song, item.arrangementId) : null;
      if (song && arrangement) {
        for (const as of arrangement.sequence) {
          const raw = song.sections.find((s) => s.id === as.sectionId);
          if (!raw) continue;
          // Verse-instance prefix ("V1" -> section V, lines prefixed "1").
          const section =
            as.prefix === null
              ? raw
              : { ...raw, lines: raw.lines.filter((l) => l.prefix === as.prefix) };
          const repeats = Math.max(1, as.repeats);
          for (let rep = 0; rep < repeats; rep++) {
            slicesOfSection(section).forEach((lines, sliceIndex) => {
              slides.push({
                serviceItemId: item.id,
                kind: item.kind,
                songId: song.id,
                arrangementId: arrangement.id,
                sectionId: section.id,
                sectionInstanceId: as.id,
                sliceIndex,
                title: `${song.title} — ${section.label}`,
                lines,
                mediaKey: null,
              });
            });
          }
        }
        continue;
      }
    }
    // Media items (image sets / videos): one slide per asset in config.assetKeys.
    if (item.kind === "media") {
      const keys = Array.isArray(item.config["assetKeys"])
        ? (item.config["assetKeys"] as unknown[]).filter((k): k is string => typeof k === "string")
        : [];
      const list = keys.length > 0 ? keys : [null];
      for (const [i, key] of list.entries()) {
        slides.push({
          serviceItemId: item.id,
          kind: item.kind,
          songId: null,
          arrangementId: null,
          sectionId: null,
          sectionInstanceId: null,
          sliceIndex: i,
          title: item.title,
          lines: [],
          mediaKey: key,
        });
      }
      continue;
    }
    // Non-song or unresolved items: inline slides.
    for (const [i, slide] of item.slides.entries()) {
      slides.push({
        serviceItemId: item.id,
        kind: item.kind,
        songId: null,
        arrangementId: null,
        sectionId: null,
        sectionInstanceId: null,
        sliceIndex: i,
        title: item.title,
        lines: slide.body.split("\n"),
        mediaKey: null,
      });
    }
    if (item.slides.length === 0) {
      slides.push({
        serviceItemId: item.id,
        kind: item.kind,
        songId: null,
        arrangementId: null,
        sectionId: null,
        sectionInstanceId: null,
        sliceIndex: 0,
        title: item.title,
        lines: [item.title],
        mediaKey: null,
      });
    }
  }
  return { slides, itemStart };
}

/** Convert a MusicalPosition into a plan slide index (or null). */
export function indexOfPosition(plan: PresentationPlan, pos: MusicalPosition): number | null {
  const i = plan.slides.findIndex(
    (s) =>
      s.serviceItemId === pos.serviceItemId &&
      s.sectionInstanceId === pos.sectionInstanceId &&
      s.sliceIndex === pos.positionWithinSection &&
      s.sectionId === pos.sectionId,
  );
  return i === -1 ? null : i;
}

/** Convert a plan slide index into a MusicalPosition. */
export function positionOfSlide(plan: PresentationPlan, index: number, sessionId: SessionId): MusicalPosition {
  const s = plan.slides[index]!;
  return {
    sessionId,
    serviceItemId: s.serviceItemId,
    songId: s.songId,
    arrangementId: s.arrangementId,
    sectionId: s.sectionId,
    sectionInstanceId: s.sectionInstanceId,
    positionWithinSection: s.sliceIndex,
  };
}

export type NavigateAction = "next" | "prev" | "first" | "last";

/** Move a position within the plan; clamps at the ends. */
export function navigate(
  plan: PresentationPlan,
  pos: MusicalPosition,
  action: NavigateAction,
): MusicalPosition {
  const cur = indexOfPosition(plan, pos) ?? 0;
  const next =
    action === "next"
      ? Math.min(cur + 1, plan.slides.length - 1)
      : action === "prev"
        ? Math.max(cur - 1, 0)
        : action === "first"
          ? 0
          : plan.slides.length - 1;
  return positionOfSlide(plan, Math.max(0, next), pos.sessionId);
}
