import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { ActivityEntry, IdGenerator, MediaAssetId, Repositories } from "@praisesuite/core";
import * as schema from "./schema.js";
import { migrate } from "./migrate.js";
import {
  SqliteMediaRepository,
  SqliteServiceRepository,
  SqliteSessionRepository,
  SqliteSongRepository,
} from "./repositories.js";
import { FilesystemFileStore } from "./file-store.js";

export * from "./schema.js";
export * from "./migrate.js";
export * from "./repositories.js";
export * from "./file-store.js";

export interface SqliteStorage {
  repositories: Repositories;
  db: Database.Database;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  /** Append an activity-log entry (OpenSong ActivityLog model). */
  logActivity(entry: Omit<ActivityEntry, "id">): void;
  /** Query the activity log, newest first. */
  activityLog(opts?: { from?: string | undefined; to?: string | undefined; action?: number | undefined; limit?: number }): ActivityEntry[];
  close(): void;
}

/**
 * Open (or create) a PraiseSuite SQLite database plus its media directory.
 * `mediaDir` defaults to `<db>.media/` next to the database file.
 */
export function openStorage(options: {
  databasePath: string;
  mediaDir?: string;
}): SqliteStorage {
  const { databasePath } = options;
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);

  const db = drizzle(sqlite, { schema });
  const mediaDir = options.mediaDir ?? `${databasePath}.media`;
  mkdirSync(mediaDir, { recursive: true });

  return {
    repositories: {
      songs: new SqliteSongRepository(db, sqlite),
      services: new SqliteServiceRepository(db),
      sessions: new SqliteSessionRepository(db),
      files: new FilesystemFileStore(mediaDir),
      media: new SqliteMediaRepository(db),
    },
    db: sqlite,
    getSetting: (key) => {
      const row = sqlite.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    },
    setSetting: (key, value) => {
      sqlite
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(key, value);
    },
    logActivity: (entry) => {
      sqlite
        .prepare(
          "INSERT INTO activity_log (at, action, song_id, filename, title, authors, ccli_number, has_chords) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          entry.at,
          entry.action,
          entry.songId,
          entry.filename,
          entry.title,
          JSON.stringify(entry.authors),
          entry.ccliNumber,
          entry.hasChords ? 1 : 0,
        );
    },
    activityLog: (opts = {}) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (opts.from !== undefined) { where.push("at >= ?"); args.push(opts.from); }
      if (opts.to !== undefined) { where.push("at <= ?"); args.push(opts.to); }
      if (opts.action !== undefined) { where.push("action = ?"); args.push(opts.action); }
      const sql =
        "SELECT * FROM activity_log" +
        (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
        " ORDER BY id DESC LIMIT ?";
      args.push(opts.limit ?? 500);
      return (sqlite.prepare(sql).all(...args) as Record<string, unknown>[]).map((r) => ({
        id: r["id"] as number,
        at: r["at"] as string,
        action: r["action"] as number,
        songId: (r["song_id"] as string | null) ?? null,
        filename: (r["filename"] as string | null) ?? null,
        title: r["title"] as string,
        authors: JSON.parse((r["authors"] as string) || "[]") as string[],
        ccliNumber: (r["ccli_number"] as string | null) ?? null,
        hasChords: r["has_chords"] === 1,
      }));
    },
    close: () => sqlite.close(),
  };
}

/**
 * Ingest a binary asset: content-addressed storage key
 * (`media/<sha256><ext>`), FileStore write, media_assets registration.
 */
export async function storeMedia(
  storage: SqliteStorage,
  ids: IdGenerator,
  input: { data: Uint8Array; mediaType: string; originalFilename?: string | null },
): Promise<{ id: MediaAssetId; storageKey: string; checksum: string }> {
  const checksum = createHash("sha256").update(input.data).digest("hex");
  const ext = extname(input.originalFilename ?? "").toLowerCase();
  const storageKey = `media/${checksum}${ext}`;
  if (!(await storage.repositories.files.has(storageKey))) {
    await storage.repositories.files.put(storageKey, input.data);
  }
  const id = ids.next() as MediaAssetId;
  await storage.repositories.media.register({
    id,
    mediaType: input.mediaType,
    storageKey,
    originalFilename: input.originalFilename ?? null,
    size: input.data.byteLength,
    checksum,
  });
  return { id, storageKey, checksum };
}
