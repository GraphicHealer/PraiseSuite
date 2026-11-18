import { strFromU8, unzipSync } from "fflate";
import type { IdGenerator, Repositories } from "../../ports/index.js";
import type { Song } from "../../domain/songs/types.js";
import type { Service } from "../../domain/services/types.js";
import type { RevisionId, ServiceId, ServiceItemId, SongId } from "../../ids.js";
import { materializeSong, parseOpenSongSong, type ParsedSong } from "./song.js";
import { parseOpenSongSet, resolveSongRefs, type ParsedServiceItem } from "./set.js";
import {
  detectDuplicates,
  existingInfo,
  type DuplicateMatch,
  type ExistingSongInfo,
} from "./duplicates.js";

export interface ImportFile {
  /** Path relative to the import root; may include folders. */
  path: string;
  text: string;
}

export interface AnalyzedSong {
  path: string;
  song?: ParsedSong;
  error?: string;
  warnings: string[];
}

export interface AnalyzedSet {
  path: string;
  name: string;
  items?: ParsedServiceItem[];
  error?: string;
  warnings: string[];
}

export interface ImportAnalysis {
  songs: AnalyzedSong[];
  sets: AnalyzedSet[];
  skipped: { path: string; reason: string }[];
  duplicates: DuplicateMatch[];
}

/** Expand a zip archive into import files (fflate — runs in Node and browsers). */
export function expandZip(data: Uint8Array): ImportFile[] {
  const entries = unzipSync(data);
  const files: ImportFile[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    // OpenSong songs/sets/settings are extensionless; skip obvious resources.
    const lower = path.toLowerCase();
    if (
      path.endsWith("/") ||
      /\.(jpe?g|png|gif|webp|mp4|mov|mp3|wav|ttf|otf|db|ds_store)$/i.test(lower)
    )
      continue;
    try {
      files.push({ path, text: strFromU8(bytes) });
    } catch {
      // non-utf8 content — skip
    }
  }
  return files;
}

function looksLikeXml(text: string): boolean {
  const head = text.slice(0, 300);
  return head.includes("<") && (head.includes("<song") || head.includes("<set") || head.includes("<?xml"));
}

/**
 * Staged import, analysis phase (PRD 5.2 steps 1-6): identify format,
 * parse, validate, report issues, detect duplicates.
 */
export function analyzeImport(
  files: ImportFile[],
  existing: ExistingSongInfo[] = [],
): ImportAnalysis {
  const songs: AnalyzedSong[] = [];
  const sets: AnalyzedSet[] = [];
  const skipped: ImportAnalysis["skipped"] = [];

  for (const file of files) {
    const name = file.path.split("/").pop() ?? file.path;
    if (!looksLikeXml(file.text)) {
      skipped.push({ path: file.path, reason: "not OpenSong XML" });
      continue;
    }
    const isSet = file.text.includes("<set") && !file.text.includes("<song");
    try {
      if (isSet) {
        const parsed = parseOpenSongSet(file.text, name);
        sets.push({ path: file.path, name, items: parsed.items, warnings: parsed.warnings });
      } else {
        const parsed = parseOpenSongSong(file.text);
        songs.push({ path: file.path, song: parsed.song, warnings: parsed.warnings });
      }
    } catch (e) {
      skipped.push({ path: file.path, reason: (e as Error).message });
    }
  }

  const parsed = songs.filter((s) => s.song).map((s) => s.song!);
  const duplicates = detectDuplicates(parsed, existing);
  return { songs, sets, skipped, duplicates };
}

export type DuplicateAction = "skip" | "replace" | "import";

export interface ImportReport {
  importedSongs: number;
  importedSets: number;
  skippedFiles: number;
  failed: { path: string; error: string }[];
  warnings: string[];
}

/**
 * Apply phase (PRD 5.2 steps 7-9): perform the import honoring duplicate
 * actions, then report.
 */
export async function applyImport(
  analysis: ImportAnalysis,
  ids: IdGenerator,
  repos: Pick<Repositories, "songs" | "services">,
  options: {
    onDuplicate?: (match: DuplicateMatch) => DuplicateAction;
    /** Persist embedded media (e.g. background <image> base64) -> storage key. */
    storeMedia?: (name: string, mediaType: string, dataBase64: string) => Promise<string>;
  } = {},
): Promise<ImportReport> {
  const report: ImportReport = {
    importedSongs: 0,
    importedSets: 0,
    skippedFiles: analysis.skipped.length,
    failed: [],
    warnings: [],
  };

  const dupActions = new Map<number, DuplicateAction>();
  for (const m of analysis.duplicates) {
    dupActions.set(m.incomingIndex, options.onDuplicate?.(m) ?? "import");
  }

  // Song-ref resolution map for set import: title, file name, and
  // folder-qualified variants (OpenSong refs are file names + path attr).
  const byKey = new Map<string, SongId>();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const addKeys = (id: SongId, title: string, folder: string | null, fileName?: string) => {
    byKey.set(norm(title), id);
    if (fileName) byKey.set(norm(fileName), id);
    if (folder) {
      byKey.set(norm(`${folder}/${title}`), id);
      if (fileName) byKey.set(norm(`${folder}/${fileName}`), id);
    }
  };
  for (const s of await repos.songs.list()) addKeys(s.id, s.title, s.folder);

  let parsedIdx = 0;
  for (const analyzed of analysis.songs) {
    if (!analyzed.song) {
      report.failed.push({ path: analyzed.path, error: analyzed.error ?? "parse failed" });
      continue;
    }
    const action = dupActions.get(parsedIdx) ?? "import";
    parsedIdx++;
    if (action === "skip") continue;
    if (action === "replace") {
      // Replace keeps the existing id — handled at M2 when repos exist;
      // for now import alongside (documented limitation).
      report.warnings.push(`${analyzed.path}: replace not yet supported; imported as new`);
    }
    // Verse backgrounds with embedded <image> data -> media storage keys.
    if (analyzed.song.backgrounds !== null && options.storeMedia !== undefined) {
      for (const bg of analyzed.song.backgrounds.items) {
        if (bg.imageData === null || bg.imageData === "" || bg.key) continue;
        try {
          bg.key = await options.storeMedia(bg.filename ?? "background.png", "image/png", bg.imageData);
        } catch {
          report.warnings.push(`${analyzed.path}: background image for "${bg.verse}" could not be stored`);
        }
      }
    }
    const song = materializeSong(analyzed.song, ids);
    // OpenSong Songs/ subfolders -> library folder (from the import path).
    // A leading "Songs/" is the OpenSong library root itself — strip it (D6).
    let dir = analyzed.path.replaceAll("\\", "/");
    const slash = dir.lastIndexOf("/");
    dir = slash > 0 ? dir.slice(0, slash) : "";
    if (dir.toLowerCase() === "songs" || dir.toLowerCase().startsWith("songs/")) {
      dir = dir.slice(6);
    }
    if (dir) song.folder = dir;
    const fileName = analyzed.path.replaceAll("\\", "/").split("/").pop();
    await repos.songs.save(song);
    addKeys(song.id, song.title, song.folder, fileName);
    report.importedSongs++;
    report.warnings.push(...analyzed.warnings.map((w) => `${analyzed.path}: ${w}`));
  }

  // Persist imported sets: resolve song refs against imported + existing
  // songs, then save as services (D1).
  for (const analyzedSet of analysis.sets) {
    if (!analyzedSet.items) {
      report.failed.push({ path: analyzedSet.path, error: analyzedSet.error ?? "parse failed" });
      continue;
    }
    const resolved = resolveSongRefs(analyzedSet.items, byKey);
    for (const item of resolved) {
      const ref = analyzedSet.items[resolved.indexOf(item)]?.songRef;
      if (item.kind === "song" && item.songId === null) {
        report.warnings.push(`${analyzedSet.path}: song "${ref ?? item.title}" not found; kept as placeholder`);
      }
    }
    const service: Service = {
      id: ids.next() as ServiceId,
      revision: {
        id: ids.next() as RevisionId,
        parentId: null,
        origin: "import",
        createdAt: new Date().toISOString(),
      },
      name: analyzedSet.name,
      date: null,
      description: null,
      items: resolved.map((item) => ({ ...item, id: ids.next() as ServiceItemId })),
    };
    await repos.services.save(service);
    report.importedSets++;
    report.warnings.push(...analyzedSet.warnings.map((w) => `${analyzedSet.path}: ${w}`));
  }
  return report;
}

export function toExistingInfo(songs: Song[]): ExistingSongInfo[] {
  return songs.map(existingInfo);
}
