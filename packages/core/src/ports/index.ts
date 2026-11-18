import type { Song } from "../domain/songs/types.js";
import type { Service } from "../domain/services/types.js";
import type { PresentationSession } from "../domain/sessions/types.js";
import type { MediaAssetId, SongId, ServiceId, SessionId } from "../ids.js";

/** Wall clock — injected so tests and platforms control time. */
export interface Clock {
  now(): Date;
}

/** Generates UUIDv7 identifiers; injected per platform. */
export interface IdGenerator {
  next(): string;
}

export interface CryptoPort {
  sha256Hex(data: Uint8Array): Promise<string>;
}

export interface SongSummary {
  id: SongId;
  title: string;
  authors: string[];
  theme: string | null;
  /** OpenSong Songs-folder path the song lives under; null = library root. */
  folder: string | null;
}

export interface SongRepository {
  get(id: SongId): Promise<Song | null>;
  save(song: Song): Promise<void>;
  delete(id: SongId): Promise<void>;
  list(): Promise<SongSummary[]>;
  search(query: string): Promise<SongSummary[]>;
}

export interface ServiceRepository {
  get(id: ServiceId): Promise<Service | null>;
  save(service: Service): Promise<void>;
  delete(id: ServiceId): Promise<void>;
  list(): Promise<Service[]>;
}

export interface SessionRepository {
  get(id: SessionId): Promise<PresentationSession | null>;
  save(session: PresentationSession): Promise<void>;
  delete(id: SessionId): Promise<void>;
  listActive(): Promise<PresentationSession[]>;
}

/** Binary media/attachment storage, keyed by stable storage key (never a path). */
export interface FileStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  listKeys(prefix?: string): Promise<string[]>;
}

export interface MediaRepository {
  register(asset: {
    id: MediaAssetId;
    mediaType: string;
    storageKey: string;
    originalFilename: string | null;
    size: number;
    checksum: string;
  }): Promise<void>;
}

/** All storage repositories, bundled for injection into the application layer. */
export interface Repositories {
  songs: SongRepository;
  services: ServiceRepository;
  sessions: SessionRepository;
  files: FileStore;
  media: MediaRepository;
}
