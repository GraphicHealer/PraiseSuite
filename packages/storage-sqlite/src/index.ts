import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { IdGenerator, MediaAssetId, Repositories } from "@praisesuite/core";
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
