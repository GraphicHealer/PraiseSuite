import { describe, expect, it } from "vitest";
import {
  createRegistry,
  LocalTransport,
  registerSongCommands,
  type Clock,
  type FileStore,
  type IdGenerator,
  type MediaRepository,
  type Repositories,
  type ServiceRepository,
  type SessionRepository,
  type Song,
  type SongRepository,
  type SongSummary,
  type CreateSongInput,
} from "../src/index.js";
import type { Service } from "../src/domain/services/types.js";
import type { PresentationSession } from "../src/domain/sessions/types.js";

function inMemoryRepos(): Repositories {
  const songs = new Map<string, Song>();
  const services = new Map<string, Service>();
  const sessions = new Map<string, PresentationSession>();
  const files = new Map<string, Uint8Array>();

  const songRepo: SongRepository = {
    get: async (id) => songs.get(id) ?? null,
    save: async (song) => void songs.set(song.id, song),
    delete: async (id) => void songs.delete(id),
    list: async () =>
      [...songs.values()].map(
        (s): SongSummary => ({
          id: s.id,
          title: s.title,
          authors: s.authors,
          theme: s.theme,
          folder: s.folder,
        }),
      ),
    search: async (q) =>
      [...songs.values()]
        .filter((s) => s.title.toLowerCase().includes(q.toLowerCase()))
        .map(
          (s): SongSummary => ({
            id: s.id,
            title: s.title,
            authors: s.authors,
            theme: s.theme,
            folder: s.folder,
          }),
        ),
  };
  const serviceRepo: ServiceRepository = {
    get: async (id) => services.get(id) ?? null,
    save: async (s) => void services.set(s.id, s),
    delete: async (id) => void services.delete(id),
    list: async () => [...services.values()],
  };
  const sessionRepo: SessionRepository = {
    get: async (id) => sessions.get(id) ?? null,
    save: async (s) => void sessions.set(s.id, s),
    delete: async (id) => void sessions.delete(id),
    listActive: async () =>
      [...sessions.values()].filter((s) => s.status === "live"),
  };
  const fileStore: FileStore = {
    put: async (key, data) => void files.set(key, data),
    get: async (key) => files.get(key) ?? null,
    delete: async (key) => void files.delete(key),
    has: async (key) => files.has(key),
    listKeys: async (prefix) =>
      [...files.keys()].filter((k) => !prefix || k.startsWith(prefix)),
  };
  const mediaRepo: MediaRepository = { register: async () => {}, findByFilename: async () => null, list: async () => [] };

  return {
    songs: songRepo,
    services: serviceRepo,
    sessions: sessionRepo,
    files: fileStore,
    media: mediaRepo,
  };
}

const fixedClock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };

let counter = 0;
const seqIds: IdGenerator = {
  next: () => `00000000-0000-7000-8000-${String(++counter).padStart(12, "0")}`,
};

describe("LocalTransport round-trip", () => {
  it("creates a song via command and reads it back via query", async () => {
    const registry = createRegistry();
    registerSongCommands(registry);
    const transport = new LocalTransport(registry, {
      repos: inMemoryRepos(),
      ids: seqIds,
      clock: fixedClock,
    });

    const created = await transport.command<CreateSongInput, SongSummary>(
      "songs.create",
      { title: "Amazing Grace", authors: ["John Newton"] },
    );
    expect(created.title).toBe("Amazing Grace");

    const fetched = await transport.query<{ id: typeof created.id }, Song | null>(
      "songs.get",
      { id: created.id },
    );
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.authors).toEqual(["John Newton"]);
    expect(fetched?.revision.parentId).toBeNull();

    const all = await transport.query<Record<string, never>, SongSummary[]>(
      "songs.list",
      {},
    );
    expect(all).toHaveLength(1);
  });

  it("rejects unknown operations", async () => {
    const transport = new LocalTransport(createRegistry(), {
      repos: inMemoryRepos(),
      ids: seqIds,
      clock: fixedClock,
    });
    await expect(transport.command("nope", {})).rejects.toThrow(
      "Unknown command: nope",
    );
  });
});
