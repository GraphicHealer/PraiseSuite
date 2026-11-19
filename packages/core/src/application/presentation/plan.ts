import type { Service, ServiceItem } from "../../domain/services/types.js";
import type { ArrangementSection, Song, SongArrangement, SongSection } from "../../domain/songs/types.js";
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
  /** Per-verse song background (OpenSong <backgrounds><background verse>); cycles across slices. */
  backgroundKey: string | null;
  /** Show the background image instead of slide text (OpenSong @background_as_text). */
  backgroundAsText: boolean;
  /**
   * OpenSong style/@blanks separator: an empty slide inserted before each
   * item (when the item name changes) and after the last one. It belongs to
   * the FOLLOWING item (blank_uses_next) so it shows that item's background;
   * the trailing blank uses the last item's.
   */
  blank: boolean;
  /** OpenSong slide @emphasize — chorus slides flip italic under highlight_chorus. */
  emphasize: boolean;
  /** OpenSong slide_group @seconds — auto-advance interval (0 = off). */
  seconds: number;
  /** OpenSong slide_group @loop — on auto-advance past the last slide, wrap to the group's first. */
  loop: boolean;
  /** OpenSong slide_group @transition — 0=default, 1=force on, 2=force off. */
  transition: number;
  /**
   * Resolved style override for this slide: the active mid-set style-change
   * stack merged under the item's own <style> (item wins). Null = default.
   */
  styleOverride: import("../../domain/styles/types.js").SlideStyleOverride | null;
  /** True while a style-change item is in effect (scripture_style suppressed). */
  setStyleActive: boolean;
}

const itemTiming = (item: ServiceItem) => ({
  seconds: typeof item.config["seconds"] === "number" ? (item.config["seconds"] as number) : item.loopSeconds,
  loop: item.config["loop"] === true || item.config["loop"] === "true" || item.loopSeconds > 0,
  transition: typeof item.config["transition"] === "number" ? (item.config["transition"] as number) : Number(item.config["transition"]) || 0,
});

export interface PresentationPlan {
  slides: PlanSlide[];
  /** Index of the first slide for each service item (for jump menus). */
  itemStart: number[];
}

/** Lines -> slide slices: only "slide"/"bar" start a new slice; "|" (inline)
 * is a line break within the same slide (SongML DeflateString). */
function slicesOfSection(section: SongSection): string[][] {
  const slices: string[][] = [[]];
  for (const line of section.lines) {
    if (line.kind !== "lyric") continue;
    if (
      (line.breakBefore === "slide" || line.breakBefore === "bar") &&
      slices[slices.length - 1]!.length > 0
    )
      slices.push([]);
    // OpenSong slide text: "_" deleted outright (chord-sheet padding),
    // multi-spaces squeezed, left-trimmed ("choo___sing" -> "choosing").
    slices[slices.length - 1]!.push(line.text.replace(/_/g, "").replace(/ {2,}/g, " ").replace(/^ +/, ""));
  }
  while (slices.length > 1 && slices[slices.length - 1]!.length === 0) slices.pop();
  return slices.length === 0 ? [[]] : slices;
}

/**
 * OpenSong per-item presentation order ("V1 V2 C") — selects which arrangement
 * section instances appear, and in what order. Tokens match section label +
 * verse prefix; unknown tokens are skipped, no matches falls back to the full
 * arrangement sequence.
 */
function sequenceForItem(song: Song, arrangement: SongArrangement, item: ServiceItem): ArrangementSection[] {
  const order = item.config["presentation"];
  if (typeof order !== "string" || order.trim() === "") return arrangement.sequence;
  const labelOf = (as: ArrangementSection) => {
    const sec = song.sections.find((s) => s.id === as.sectionId);
    return sec ? `${sec.label}${as.prefix ?? ""}` : "";
  };
  const used = new Set<string>();
  const chosen: ArrangementSection[] = [];
  for (const token of order.trim().split(/\s+/)) {
    const match = arrangement.sequence.find(
      (as) => !used.has(as.id) && labelOf(as).toLowerCase() === token.toLowerCase(),
    );
    if (match) {
      used.add(match.id);
      chosen.push(match);
    }
  }
  return chosen.length > 0 ? chosen : arrangement.sequence;
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
  // OpenSong InsertBlanksIntoSet (style/@blanks): an empty slide before each
  // group whose name changes and one after the last. The blank carries the
  // following item's id so it inherits that item's style/background
  // (blank_uses_next); the trailing blank carries the last item's.
  const pushBlank = (item: ServiceItem, sliceIndex: number) =>
    slides.push({
      serviceItemId: item.id,
      kind: item.kind,
      // Carry the song ref so the separator shows that song's background.
      songId: item.kind === "song" ? item.songId : null,
      arrangementId: null,
      sectionId: null,
      sectionInstanceId: null,
      // Negative sliceIndexes keep positions unique: -1 leads an item, -2 trails the set.
      sliceIndex,
      title: "",
      lines: [],
      mediaKey: null,
      backgroundKey: null,
      backgroundAsText: false,
      blank: true,
      // Blank groups carry no timing attrs in OpenSong — never auto-advance.
      emphasize: false,
      seconds: 0,
      loop: false,
      transition: 0,
      styleOverride: effectiveStyle(item),
      setStyleActive: styleStack.length > 0,
    });
  let prevName: string | null = null;
  // OpenSong ProcessStyles: type="style" groups push (@action=new) or pop
  // (@action=revert) the set-level style for the groups that follow them.
  type StyleOverride = import("../../domain/styles/types.js").SlideStyleOverride;
  const styleStack: StyleOverride[] = [];
  const mergeOverride = (a: StyleOverride | undefined, b: StyleOverride | undefined): StyleOverride | null => {
    if (!a && !b) return null;
    const pick = <K extends "title" | "body" | "subtitle">(k: K) =>
      a?.[k] || b?.[k] ? { ...(a?.[k] ?? {}), ...(b?.[k] ?? {}) } : undefined;
    const out: StyleOverride = { ...(a ?? {}), ...(b ?? {}) };
    for (const k of ["title", "body", "subtitle"] as const) {
      const m = pick(k);
      if (m) out[k] = m;
    }
    return out;
  };
  const effectiveStyle = (item: ServiceItem) =>
    mergeOverride(styleStack[styleStack.length - 1], item.config["style"] as StyleOverride | undefined);

  for (const item of service.items) {
    if (item.kind === "style") {
      // Style-change groups produce no slides and no separator blanks.
      const action = item.config["action"];
      if (action === "revert") styleStack.pop();
      else if (item.config["style"]) styleStack.push(item.config["style"] as StyleOverride);
      continue;
    }
    const name = item.title;
    if (name !== prevName) pushBlank(item, -1);
    prevName = name;
    // The blank is the first slide of the item — Next Section lands on it.
    itemStart.push(slides.length - 1 >= 0 && slides[slides.length - 1]!.blank ? slides.length - 1 : slides.length);
    if (item.kind === "song" && item.songId !== null) {
      const song = songsById.get(item.songId);
      const arrangement = song ? resolveArrangement(song, item.arrangementId) : null;
      if (song && arrangement) {
        const timing = itemTiming(item);
        for (const as of sequenceForItem(song, arrangement, item)) {
          const raw = song.sections.find((s) => s.id === as.sectionId);
          if (!raw) continue;
          // Verse-instance prefix ("V1" -> section V, lines prefixed "1").
          const section =
            as.prefix === null
              ? raw
              : { ...raw, lines: raw.lines.filter((l) => l.prefix === as.prefix) };
          // Verse backgrounds for this section, cycled across slices
          // (OpenSong background[@verse='V'|'v'], xbackIndex per sub-section).
          const label = raw.label.toLowerCase();
          const backs = (song.backgrounds?.items ?? []).filter(
            (b) => b.verse.toLowerCase() === label,
          );
          const repeats = Math.max(1, as.repeats);
          for (let rep = 0; rep < repeats; rep++) {
            slicesOfSection(section).forEach((lines, sliceIndex) => {
              const bg = backs.length > 0 ? backs[Math.min(sliceIndex, backs.length - 1)]! : null;
              slides.push({
                serviceItemId: item.id,
                kind: item.kind,
                songId: song.id,
                arrangementId: arrangement.id,
                sectionId: section.id,
                sectionInstanceId: as.id,
                sliceIndex,
                title: `${song.title} — ${section.label}${as.prefix ?? ""}`,
                lines,
                mediaKey: null,
                /* bg.key is a storage key; bg.filename covers OpenSong refs
                 * whose media lives outside the song file — the slide route
                 * resolves filenames through the media registry. */
                backgroundKey: (bg?.key ?? bg?.filename) || null,
                backgroundAsText: bg !== null && (song.backgrounds?.asText ?? false),
                blank: false,
                emphasize: /^c/i.test(raw.label),
                ...timing,
                styleOverride: effectiveStyle(item),
                setStyleActive: styleStack.length > 0,
              });
            });
          }
        }
        continue;
      }
    }
    // Media items (image sets / videos): one slide per asset — from
    // config.assetKeys (UI-added) or config.images[].storageKey (OpenSong
    // imported <image> groups, N4/R2).
    if (item.kind === "media") {
      const timing = itemTiming(item);
      const fromAssets = Array.isArray(item.config["assetKeys"])
        ? (item.config["assetKeys"] as unknown[]).filter((k): k is string => typeof k === "string")
        : [];
      const fromImages = Array.isArray(item.config["images"])
        ? (item.config["images"] as { storageKey?: string }[])
            .map((i) => i.storageKey)
            .filter((k): k is string => typeof k === "string")
        : [];
      const keys = fromAssets.length > 0 ? fromAssets : fromImages;
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
          backgroundKey: null,
          backgroundAsText: false,
          blank: false,
          emphasize: false,
          ...timing,
          styleOverride: effectiveStyle(item),
          setStyleActive: styleStack.length > 0,
        });
      }
      continue;
    }
    // Non-song or unresolved items: inline slides.
    const timing = itemTiming(item);
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
        backgroundKey: null,
        backgroundAsText: false,
        blank: false,
        emphasize: false,
        ...timing,
        styleOverride: effectiveStyle(item),
        setStyleActive: styleStack.length > 0,
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
        backgroundKey: null,
        backgroundAsText: false,
        blank: false,
        emphasize: false,
        ...timing,
        styleOverride: effectiveStyle(item),
        setStyleActive: styleStack.length > 0,
      });
    }
  }
  const last = service.items[service.items.length - 1];
  if (last) pushBlank(last, -2);
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
