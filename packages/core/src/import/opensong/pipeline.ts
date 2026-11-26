import { strFromU8, unzipSync } from "fflate";
import type { IdGenerator, Repositories } from "../../ports/index.js";
import type { Song } from "../../domain/songs/types.js";
import type { Service } from "../../domain/services/types.js";
import type { MediaAssetId, RevisionId, ServiceId, ServiceItemId, SongId } from "../../ids.js";
import { materializeSong, parseOpenSongSong, type ParsedSong } from "./song.js";
import { normRefKey, parseOpenSongSet, resolveSongRefs, type ParsedServiceItem } from "./set.js";
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
  /** OpenSong/Zefania Bible XML files — imported via the bibles store. */
  bibles: { path: string; name: string; xml: string }[];
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
  return head.includes("<") && (head.includes("<song") || head.includes("<set") || head.includes("<bible") || head.includes("<?xml"));
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

  const bibles: ImportAnalysis["bibles"] = [];

  for (const file of files) {
    const name = file.path.split("/").pop() ?? file.path;
    if (file.text.includes("<present_settings")) {
      skipped.push({ path: file.path, reason: "settings file (import via Settings)" });
      continue;
    }
    if (!looksLikeXml(file.text)) {
      skipped.push({ path: file.path, reason: "not OpenSong XML" });
      continue;
    }
    // Bible files (OpenSong Scripture folder / Zefania): <bible> or
    // <XMLBIBLE> root — routed to the bibles store, not the song parser.
    if (/<bible[\s>]|<XMLBIBLE[\s>]/i.test(file.text.slice(0, 400))) {
      bibles.push({ path: file.path, name, xml: file.text });
      continue;
    }
    // Root-element test: <song_subtitle> inside style groups must not count
    // as a song doc, and <set> must be the root tag (not <settings etc.).
    const isSet = /<set[\s>]/.test(file.text) && !/<song[\s>]/.test(file.text);
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
  return { songs, sets, bibles, skipped, duplicates };
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
    storeMedia?: (
      name: string,
      mediaType: string,
      dataBase64: string,
    ) => Promise<{ id: string; storageKey: string }>;
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
  const norm = normRefKey;
  const addKeys = (id: SongId, title: string, folder: string | null, fileName?: string | null) => {
    byKey.set(norm(title), id);
    if (fileName) byKey.set(norm(fileName), id);
    if (folder) {
      byKey.set(norm(`${folder}/${title}`), id);
      if (fileName) byKey.set(norm(`${folder}/${fileName}`), id);
    }
  };
  // Existing songs key by title AND stored fileName — OpenSong set refs use
  // file names, which can differ from <title> ("X, The" files, *-suffixed
  // titles, filename-illegal chars). Skipping fileName here stranded refs
  // when songs and sets were imported in separate runs.
  for (const s of await repos.songs.list()) addKeys(s.id, s.title, s.folder, s.fileName);

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
          bg.key = (await options.storeMedia(bg.filename ?? "background.png", "image/png", bg.imageData)).storageKey;
        } catch {
          report.warnings.push(`${analyzed.path}: background image for "${bg.verse}" could not be stored`);
        }
      }
    }
    // Same for an image embedded in the song's <style><background> — the raw
    // XML keeps its data for export; the key makes it render.
    let styleBackgroundKey: string | null = null;
    if (analyzed.song.styleBackgroundData && options.storeMedia !== undefined) {
      try {
        styleBackgroundKey = (
          await options.storeMedia("opensong-style-background.jpg", "image/jpeg", analyzed.song.styleBackgroundData)
        ).storageKey;
      } catch {
        report.warnings.push(`${analyzed.path}: style background image could not be stored`);
      }
    }
    const song = materializeSong(analyzed.song, ids);
    song.styleBackgroundKey = styleBackgroundKey;
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
    song.fileName = fileName ?? null;
    await repos.songs.save(song);
    addKeys(song.id, song.title, song.folder, fileName);
    report.importedSongs++;
    report.warnings.push(...analyzed.warnings.map((w) => `${analyzed.path}: ${w}`));
  }

  // Persist imported sets: resolve song refs against imported + existing
  // songs, then save as services (D1). Re-importing the same set name skips
  // it (N5) — songs dedupe, so should sets.
  const existingSetNames = new Set(
    (await repos.services.list()).map((s) => s.name),
  );
  for (const analyzedSet of analysis.sets) {
    if (!analyzedSet.items) {
      report.failed.push({ path: analyzedSet.path, error: analyzedSet.error ?? "parse failed" });
      continue;
    }
    if (existingSetNames.has(analyzedSet.name)) {
      report.warnings.push(`${analyzedSet.path}: set "${analyzedSet.name}" already exists; skipped`);
      continue;
    }
    existingSetNames.add(analyzedSet.name);
    const resolved = resolveSongRefs(analyzedSet.items, byKey);
    for (const item of resolved) {
      const ref = analyzedSet.items[resolved.indexOf(item)]?.songRef;
      if (item.kind === "song" && item.songId === null) {
        report.warnings.push(`${analyzedSet.path}: song "${ref ?? item.title}" not found; kept as placeholder`);
      }
    }
    // Image groups: store each embedded <image> as a media asset (N4) so
    // the set keeps its pictures and export can re-embed them.
    const items: Service["items"] = [];
    for (const [i, item] of resolved.entries()) {
      const parsed = analyzedSet.items[i];
      let mediaAssetId = item.mediaAssetId;
      const stored: { storageKey?: string; filename?: string; description?: string }[] = [];
      for (const img of parsed?.images ?? []) {
        if (img.base64 && img.base64.trim() !== "" && options.storeMedia !== undefined) {
          try {
            const m = await options.storeMedia(
              img.filename ?? img.description ?? "image.png",
              "image/png",
              img.base64,
            );
            stored.push({
              storageKey: m.storageKey,
              ...(img.filename ? { filename: img.filename } : {}),
              ...(img.description ? { description: img.description } : {}),
            });
            mediaAssetId = mediaAssetId ?? (m.id as MediaAssetId);
          } catch {
            report.warnings.push(`${analyzedSet.path}: image in "${analyzedSet.name}" could not be stored`);
          }
        } else if (img.filename) {
          stored.push({
            filename: img.filename,
            ...(img.description ? { description: img.description } : {}),
          });
        }
      }
      if (stored.length > 0) item.config["images"] = stored;
      // Style-change groups can embed a <style><background> base64 image —
      // it needs media storage just like a song's, else the override's
      // backgroundKey holds raw data that can't resolve to a URL.
      const st = item.config["style"] as { backgroundKey?: string | null } | undefined;
      if (
        st && typeof st.backgroundKey === "string" && st.backgroundKey.length > 200 &&
        !st.backgroundKey.startsWith("media/") && options.storeMedia !== undefined
      ) {
        try {
          st.backgroundKey = (await options.storeMedia("opensong-style-background.jpg", "image/jpeg", st.backgroundKey)).storageKey;
        } catch {
          report.warnings.push(`${analyzedSet.path}: style background for "${item.title}" could not be stored`);
        }
      }
      items.push({ ...item, id: ids.next() as ServiceItemId, mediaAssetId });
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
      items,
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
