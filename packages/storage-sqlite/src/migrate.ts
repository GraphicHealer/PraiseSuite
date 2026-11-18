import type Database from "better-sqlite3";

/**
 * Versioned DDL, applied in order and tracked via PRAGMA user_version.
 * drizzle-kit can later generate equivalent Postgres DDL from schema.ts.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors TEXT NOT NULL,
    theme TEXT,
    secondary_theme TEXT,
    ccli_number TEXT,
    default_key TEXT,
    revision_id TEXT NOT NULL,
    revision_parent_id TEXT,
    data TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
    song_id UNINDEXED, title, authors, themes, lyrics
  );
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT,
    description TEXT,
    revision_id TEXT NOT NULL,
    revision_parent_id TEXT,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    service_id TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT,
    size INTEGER NOT NULL,
    checksum TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revisions (
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    parent_id TEXT,
    origin TEXT NOT NULL,
    created_at TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    PRIMARY KEY (object_type, object_id, revision_id)
  );
  `,
];

export function migrate(db: Database.Database): void {
  const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec(MIGRATIONS[i]!);
    db.pragma(`user_version = ${i + 1}`);
  }
}
