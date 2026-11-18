import type Database from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  MediaAssetId,
  MediaRepository,
  Service,
  ServiceId,
  ServiceRepository,
  SessionId,
  SessionRepository,
  PresentationSession,
  Song,
  SongId,
  SongRepository,
  SongSummary,
} from "@praisesuite/core";
import * as schema from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

const OBJECT_TYPES = { song: "song", service: "service", session: "session" } as const;

function recordRevision(
  db: Db,
  objectType: string,
  objectId: string,
  entity: { revision: { id: string; parentId: string | null; origin: string; createdAt: string } },
  data: string,
): void {
  db.insert(schema.revisions)
    .values({
      objectType,
      objectId,
      revisionId: entity.revision.id,
      parentId: entity.revision.parentId,
      origin: entity.revision.origin,
      createdAt: entity.revision.createdAt,
      snapshot: data,
    })
    .onConflictDoNothing()
    .run();
}

/** Build an FTS5 MATCH expression: each word becomes a prefix token. */
function ftsQuery(raw: string): string | null {
  const terms = raw
    .replace(/"/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");
}

export class SqliteSongRepository implements SongRepository {
  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {}

  async get(id: SongId): Promise<Song | null> {
    const row = this.db.select().from(schema.songs).where(eq(schema.songs.id, id)).get();
    return row ? (JSON.parse(row.data) as Song) : null;
  }

  async save(song: Song): Promise<void> {
    const data = JSON.stringify(song);
    this.db
      .insert(schema.songs)
      .values({
        id: song.id,
        title: song.title,
        authors: JSON.stringify(song.authors),
        theme: song.theme,
        secondaryTheme: song.secondaryTheme,
        ccliNumber: song.ccliNumber,
        defaultKey: song.defaultKey,
        folder: song.folder,
        revisionId: song.revision.id,
        revisionParentId: song.revision.parentId,
        data,
      })
      .onConflictDoUpdate({
        target: schema.songs.id,
        set: {
          title: song.title,
          authors: JSON.stringify(song.authors),
          theme: song.theme,
          secondaryTheme: song.secondaryTheme,
          ccliNumber: song.ccliNumber,
          defaultKey: song.defaultKey,
          folder: song.folder,
          revisionId: song.revision.id,
          revisionParentId: song.revision.parentId,
          data,
        },
      })
      .run();
    this.sqlite.prepare("DELETE FROM songs_fts WHERE song_id = ?").run(song.id);
    this.sqlite
      .prepare("INSERT INTO songs_fts (song_id, title, authors, themes, lyrics) VALUES (?, ?, ?, ?, ?)")
      .run(
        song.id,
        song.title,
        song.authors.join(" "),
        `${song.theme ?? ""} ${song.secondaryTheme ?? ""}`.trim(),
        song.sections
          .flatMap((s) => s.lines.filter((l) => l.kind === "lyric").map((l) => l.text))
          .join("\n"),
      );
    recordRevision(this.db, OBJECT_TYPES.song, song.id, song, data);
  }

  async delete(id: SongId): Promise<void> {
    this.db.delete(schema.songs).where(eq(schema.songs.id, id)).run();
    this.sqlite.prepare("DELETE FROM songs_fts WHERE song_id = ?").run(id);
  }

  async list(): Promise<SongSummary[]> {
    const rows = this.db
      .select({
        id: schema.songs.id,
        title: schema.songs.title,
        authors: schema.songs.authors,
        theme: schema.songs.theme,
        folder: schema.songs.folder,
      })
      .from(schema.songs)
      .orderBy(asc(schema.songs.folder), asc(schema.songs.title))
      .all();
    return rows.map((r) => ({
      id: r.id as SongId,
      title: r.title,
      authors: JSON.parse(r.authors) as string[],
      theme: r.theme,
      folder: r.folder,
    }));
  }

  async search(query: string): Promise<SongSummary[]> {
    const match = ftsQuery(query);
    if (match === null) return this.list();
    try {
      const rows = this.sqlite
        .prepare("SELECT song_id FROM songs_fts WHERE songs_fts MATCH ?")
        .all(match) as { song_id: string }[];
      const ids = new Set(rows.map((r) => r.song_id));
      return (await this.list()).filter((s) => ids.has(s.id));
    } catch {
      // Malformed FTS syntax — fall back to substring matching.
      const q = query.toLowerCase();
      return (await this.list()).filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.authors.some((a) => a.toLowerCase().includes(q)) ||
          (s.theme ?? "").toLowerCase().includes(q),
      );
    }
  }
}

export class SqliteServiceRepository implements ServiceRepository {
  constructor(private readonly db: Db) {}

  async get(id: ServiceId): Promise<Service | null> {
    const row = this.db.select().from(schema.services).where(eq(schema.services.id, id)).get();
    return row ? (JSON.parse(row.data) as Service) : null;
  }

  async save(service: Service): Promise<void> {
    const data = JSON.stringify(service);
    this.db
      .insert(schema.services)
      .values({
        id: service.id,
        name: service.name,
        date: service.date,
        description: service.description,
        revisionId: service.revision.id,
        revisionParentId: service.revision.parentId,
        data,
      })
      .onConflictDoUpdate({
        target: schema.services.id,
        set: {
          name: service.name,
          date: service.date,
          description: service.description,
          revisionId: service.revision.id,
          revisionParentId: service.revision.parentId,
          data,
        },
      })
      .run();
    recordRevision(this.db, OBJECT_TYPES.service, service.id, service, data);
  }

  async delete(id: ServiceId): Promise<void> {
    this.db.delete(schema.services).where(eq(schema.services.id, id)).run();
  }

  async list(): Promise<Service[]> {
    const rows = this.db.select().from(schema.services).orderBy(asc(schema.services.name)).all();
    return rows.map((r) => JSON.parse(r.data) as Service);
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async get(id: SessionId): Promise<PresentationSession | null> {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    return row ? (JSON.parse(row.data) as PresentationSession) : null;
  }

  async save(session: PresentationSession): Promise<void> {
    const data = JSON.stringify(session);
    this.db
      .insert(schema.sessions)
      .values({
        id: session.id,
        serviceId: session.serviceId,
        name: session.name,
        status: session.status,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        data,
      })
      .onConflictDoUpdate({
        target: schema.sessions.id,
        set: {
          serviceId: session.serviceId,
          name: session.name,
          status: session.status,
          lastActivityAt: session.lastActivityAt,
          data,
        },
      })
      .run();
  }

  async delete(id: SessionId): Promise<void> {
    this.db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
  }

  async listActive(): Promise<PresentationSession[]> {
    const rows = this.db
      .select()
      .from(schema.sessions)
      .all()
      .filter((r) => r.status !== "ended");
    return rows.map((r) => JSON.parse(r.data) as PresentationSession);
  }
}

export class SqliteMediaRepository implements MediaRepository {
  constructor(private readonly db: Db) {}

  async register(asset: {
    id: MediaAssetId;
    mediaType: string;
    storageKey: string;
    originalFilename: string | null;
    size: number;
    checksum: string;
  }): Promise<void> {
    this.db
      .insert(schema.mediaAssets)
      .values(asset)
      .onConflictDoNothing({ target: schema.mediaAssets.storageKey })
      .run();
  }
}
