import type { Service, ServiceItem } from "../../domain/services/types.js";
import type { Song } from "../../domain/songs/types.js";
import { asRecord, asString, parseXml } from "./xml.js";

export interface SetParseResult {
  name: string;
  items: ParsedServiceItem[];
  warnings: string[];
}

/** ServiceItem draft — ids assigned by the importer; songRef is resolved by name/path after songs import. */
export interface ParsedServiceItem extends Omit<ServiceItem, "id" | "songId" | "arrangementId"> {
  /** OpenSong song reference: `name` attr, may be "Folder/Title" path. */
  songRef: string | null;
  /** Embedded <image> base64 / linked <filename> per slide (image groups). */
  images: { base64: string | null; filename: string | null; description: string | null }[];
}

function toArray(v: unknown): Record<string, unknown>[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map(asRecord);
}

function slidesOf(group: Record<string, unknown>): { body: string }[] {
  const slides = asRecord(group["slides"]);
  return toArray(slides["slide"]).map((s) => ({ body: asString(s["body"]) }));
}

function imagesOf(group: Record<string, unknown>): ParsedServiceItem["images"] {
  const slides = asRecord(group["slides"]);
  return toArray(slides["slide"]).map((s) => ({
    base64: asString(s["image"]) || null,
    filename: asString(s["filename"]) || null,
    description: asString(s["description"]) || null,
  }));
}

/**
 * Parse an OpenSong set file into service-item drafts. `song` groups keep
 * their by-name reference (songRef) for the importer to resolve; `custom`
 * and `scripture` groups carry their inline slides.
 */
export function parseOpenSongSet(xml: string, fallbackName: string): SetParseResult {
  const warnings: string[] = [];
  let doc: unknown;
  try {
    doc = parseXml(xml);
  } catch (e) {
    throw new Error(`Invalid OpenSong set XML: ${(e as Error).message}`);
  }
  const set = asRecord(asRecord(doc)["set"]);
  if (Object.keys(set).length === 0) {
    throw new Error("Invalid OpenSong set: no <set> root element");
  }

  const groups = toArray(asRecord(set["slide_groups"])["slide_group"]);
  const items: ParsedServiceItem[] = [];

  for (const group of groups) {
    const name = asString(group["@_name"]);
    const type = asString(group["@_type"]) || "custom";
    const title = asString(group["title"]) || name;
    const subtitle = asString(group["subtitle"]) || null;
    const notes = asString(group["notes"]) || null;
    const loop = asString(group["@_loop"]) === "true";
    const seconds = Number.parseInt(asString(group["@_seconds"]) || "0", 10) || 0;

    const config: Record<string, unknown> = {};
    // OpenSong per-item overrides (round-tripped on export).
    const presentation = asString(group["@_presentation"]);
    if (presentation) config["presentation"] = presentation;
    const print = asString(group["@_print"]);
    if (print) config["print"] = print;
    const transition = asString(group["@_transition"]);
    if (transition) config["transition"] = transition;

    const base = {
      kind: "custom-slides" as ServiceItem["kind"],
      songRef: null as string | null,
      mediaAssetId: null,
      title,
      subtitle,
      notes,
      slides: slidesOf(group),
      images: [] as ParsedServiceItem["images"],
      loopSeconds: loop ? seconds : 0,
      config,
    };

    if (type === "song") {
      // `name` = file name; `path` attr = Songs subfolder (D9).
      const path = asString(group["@_path"]);
      items.push({ ...base, kind: "song", songRef: path ? `${path}/${name}` : name, slides: [] });
    } else if (type === "scripture") {
      items.push({ ...base, kind: "scripture" });
    } else if (type === "image") {
      config["openSongType"] = "image";
      config["imagePath"] = name;
      const resize = asString(group["@_resize"]);
      if (resize) config["resize"] = resize;
      const keepAspect = asString(group["@_keep_aspect"]);
      if (keepAspect) config["keepAspect"] = keepAspect;
      items.push({ ...base, kind: "media", images: imagesOf(group) });
    } else if (type === "custom") {
      items.push(base);
    } else {
      warnings.push(`Unknown slide_group type "${type}" (${name}); imported as custom`);
      items.push(base);
    }
  }

  return { name: fallbackName, items, warnings };
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Resolve OpenSong song references. `byKey` is keyed by normalized title,
 * file name, `folder/title` and `folder/fileName`; refs are tried as
 * `path/name` first, then bare `name` (D9).
 */
export function resolveSongRefs(
  items: ParsedServiceItem[],
  byKey: ReadonlyMap<string, Song["id"]>,
): ServiceItem[] {
  return items.map((item, i) => {
    let songId = null;
    if (item.songRef) {
      const ref = normKey(item.songRef);
      const base = normKey(item.songRef.split("/").pop() ?? item.songRef);
      songId = byKey.get(ref) ?? byKey.get(base) ?? null;
    }
    return { ...item, id: `pending-${i}` as ServiceItem["id"], songId, arrangementId: null };
  });
}

export type { Service };
