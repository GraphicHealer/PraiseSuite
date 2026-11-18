import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  IdGenerator,
  RevisionId,
  SongSectionId,
  PresentationSession,
  Service,
  Song,
  SongId,
} from "@praisesuite/core";
import { openStorage, storeMedia, type SqliteStorage } from "../src/index.js";

let n = 0;
const ids: IdGenerator = { next: () => `id-${++n}` };

function makeSong(over: Partial<Song> = {}): Song {
  return {
    id: ids.next() as SongId,
    revision: { id: "rev-1" as RevisionId, parentId: null, origin: "test", createdAt: "2026-01-01T00:00:00Z" },
    title: "Amazing Grace",
    authors: ["John Newton"],
    copyright: null,
    ccliNumber: "1037882",
    defaultKey: "G",
    tempo: null,
    timeSignature: null,
    aka: null,
    keyLine: null,
    theme: "God: Attributes",
    secondaryTheme: null,
    userFields: { user1: "", user2: "", user3: "" },
    sections: [
      {
        id: "sec-1" as SongSectionId,
        type: "verse",
        label: "V1",
        options: {},
        lines: [
          {
            text: "Amazing grace how sweet the sound",
            chords: [],
            breakBefore: "none",
            prefix: null,
            kind: "lyric",
            lang: null,
          },
        ],
      },
    ],
    arrangements: [],
    background: null,
    notes: null,
    ...over,
  };
}

async function withStorage(fn: (storage: SqliteStorage) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "praisesuite-"));
  const storage = openStorage({ databasePath: join(dir, "db.sqlite") });
  try {
    await fn(storage);
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

describe("sqlite storage", () => {
  it("round-trips a song with nested content", () =>
    withStorage(async ({ repositories }) => {
      const song = makeSong();
      await repositories.songs.save(song);
      expect(await repositories.songs.get(song.id)).toEqual(song);
      await repositories.songs.delete(song.id);
      expect(await repositories.songs.get(song.id)).toBeNull();
    }));

  it("FTS5 search finds songs by title, author, and lyrics", () =>
    withStorage(async ({ repositories }) => {
      await repositories.songs.save(makeSong());
      await repositories.songs.save(
        makeSong({
          title: "Holy Holy Holy",
          authors: ["Reginald Heber"],
          ccliNumber: "1156",
          sections: [
            {
              id: "sec-2" as SongSectionId,
              type: "verse",
              label: "V1",
              options: {},
              lines: [
                {
                  text: "Holy holy holy Lord God Almighty",
                  chords: [],
                  breakBefore: "none",
                  prefix: null,
                  kind: "lyric",
                  lang: null,
                },
              ],
            },
          ],
        }),
      );

      const byTitle = await repositories.songs.search("amazing");
      expect(byTitle.map((s) => s.title)).toEqual(["Amazing Grace"]);

      const byAuthor = await repositories.songs.search("Heber");
      expect(byAuthor.map((s) => s.title)).toEqual(["Holy Holy Holy"]);

      const byLyrics = await repositories.songs.search("sweet sound");
      expect(byLyrics.map((s) => s.title)).toEqual(["Amazing Grace"]);

      const all = await repositories.songs.search("");
      expect(all).toHaveLength(2);
    }));

  it("lists summaries sorted by title", () =>
    withStorage(async ({ repositories }) => {
      await repositories.songs.save(makeSong({ title: "Zulu Song" }));
      await repositories.songs.save(makeSong({ title: "Alpha Song" }));
      const list = await repositories.songs.list();
      expect(list.map((s) => s.title)).toEqual(["Alpha Song", "Zulu Song"]);
    }));

  it("round-trips services and sessions", () =>
    withStorage(async ({ repositories }) => {
      const service: Service = {
        id: "svc-1" as Service["id"],
        revision: { id: "rev-1" as RevisionId, parentId: null, origin: "test", createdAt: "2026-01-01T00:00:00Z" },
        name: "Sunday AM",
        date: "2026-01-04",
        description: null,
        items: [],
      };
      await repositories.services.save(service);
      expect(await repositories.services.get(service.id)).toEqual(service);

      const session: PresentationSession = {
        id: "sess-1" as PresentationSession["id"],
        serviceId: service.id,
        name: "Main",
        status: "live",
        position: {
          sessionId: "sess-1" as PresentationSession["id"],
          serviceItemId: null,
          songId: null,
          arrangementId: null,
          sectionId: null,
          sectionInstanceId: null,
          positionWithinSection: 0,
        },
        createdAt: "2026-01-01T00:00:00Z",
        lastActivityAt: "2026-01-01T00:00:00Z",
      };
      await repositories.sessions.save(session);
      expect(await repositories.sessions.listActive()).toHaveLength(1);
      await repositories.sessions.save({ ...session, status: "ended" });
      expect(await repositories.sessions.listActive()).toHaveLength(0);
    }));

  it("records revision history per save", () =>
    withStorage(async ({ repositories, db }) => {
      const song = makeSong();
      await repositories.songs.save(song);
      await repositories.songs.save({
        ...song,
        revision: { id: "rev-2" as RevisionId, parentId: "rev-1" as RevisionId, origin: "test", createdAt: "2026-01-01T00:01:00Z" },
      });
      const rows = db
        .prepare("SELECT revision_id FROM revisions WHERE object_id = ? ORDER BY created_at")
        .all(song.id) as { revision_id: string }[];
      expect(rows.map((r) => r.revision_id)).toEqual(["rev-1", "rev-2"]);
    }));

  it("FileStore stores, lists, and protects against traversal", () =>
    withStorage(async ({ repositories }) => {
      const files = repositories.files;
      await files.put("media/abc.png", new Uint8Array([1, 2, 3]));
      expect(await files.has("media/abc.png")).toBe(true);
      expect(await files.get("media/abc.png")).toEqual(new Uint8Array([1, 2, 3]));
      expect(await files.listKeys()).toEqual(["media/abc.png"]);
      expect(await files.get("media/missing.png")).toBeNull();
      await files.delete("media/abc.png");
      expect(await files.has("media/abc.png")).toBe(false);

      await expect(files.put("../evil.txt", new Uint8Array([0]))).rejects.toThrow();
      await expect(files.get("..%2F..%2Fetc")).rejects.toThrow();
    }));

  it("storeMedia writes content-addressed files with checksums", () =>
    withStorage(async (storage) => {
      const { storageKey, checksum } = await storeMedia(storage, ids, {
        data: new Uint8Array([9, 9, 9]),
        mediaType: "image/png",
        originalFilename: "logo.png",
      });
      expect(storageKey).toBe(`media/${checksum}.png`);
      expect(await storage.repositories.files.get(storageKey)).toEqual(new Uint8Array([9, 9, 9]));
      const row = storage.db
        .prepare("SELECT checksum FROM media_assets WHERE storage_key = ?")
        .get(storageKey) as { checksum: string };
      expect(row.checksum).toBe(checksum);
    }));
});
