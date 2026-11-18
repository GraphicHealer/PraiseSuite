import type { PresentationSession, Service, Song, SongSummary } from "@praisesuite/core";

export interface SlideResponse {
  sessionId: string;
  status: string;
  blanked: boolean;
  slide: { index: number; total: number; title: string; lines: string[]; kind: string } | null;
}

export interface ImportPreview {
  songs: {
    path: string;
    title: string | null;
    authors: string[];
    sections: number;
    warnings: string[];
    error: string | null;
  }[];
  sets: { path: string; name: string; items: number; warnings: string[] }[];
  skipped: { path: string; reason: string }[];
  duplicates: number;
}

export interface ImportReport {
  importedSongs: number;
  importedSets: number;
  skippedFiles: number;
  failed: { path: string; error: string }[];
  warnings: string[];
}

export interface ImportFilePayload {
  path: string;
  text: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Remote transport for the web app (TAS 3.4): the REST v1 surface mirrors
 * the in-process command/query bus in the core.
 */
class Api {
  private token: string | null = localStorage.getItem("ps.token");

  get isAuthed(): boolean {
    return this.token !== null;
  }

  setToken(t: string | null): void {
    this.token = t;
    if (t) localStorage.setItem("ps.token", t);
    else localStorage.removeItem("ps.token");
  }

  async req<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: { code: string; message: string } })
      | null;
    if (!res.ok) {
      const err = data?.error;
      throw new ApiError(res.status, err?.code ?? "error", err?.message ?? res.statusText);
    }
    return data as T;
  }

  // auth
  setup = (password: string) =>
    this.req<{ ok: boolean }>("/api/v1/auth/setup", { method: "POST", body: { password } });
  login = async (password: string) => {
    const r = await this.req<{ token: string }>("/api/v1/auth/login", {
      method: "POST",
      body: { password },
    });
    this.setToken(r.token);
  };
  logout = () => this.setToken(null);

  // songs
  songs = (query?: string) =>
    this.req<SongSummary[]>(`/api/v1/songs${query ? `?query=${encodeURIComponent(query)}` : ""}`);
  song = (id: string) => this.req<Song>(`/api/v1/songs/${encodeURIComponent(id)}`);
  saveSong = (song: Song) =>
    this.req<Song>(`/api/v1/songs/${encodeURIComponent(song.id)}`, { method: "PUT", body: song });
  deleteSong = (id: string) =>
    this.req<{ ok: boolean }>(`/api/v1/songs/${encodeURIComponent(id)}`, { method: "DELETE" });
  createSong = (title: string, authors: string[] = []) =>
    this.req<SongSummary>("/api/v1/songs", { method: "POST", body: { title, authors } });

  // services
  services = () => this.req<Service[]>("/api/v1/services");
  service = (id: string) => this.req<Service>(`/api/v1/services/${encodeURIComponent(id)}`);
  saveService = (service: Service) =>
    this.req<Service>(`/api/v1/services/${encodeURIComponent(service.id)}`, {
      method: "PUT",
      body: service,
    });
  deleteService = (id: string) =>
    this.req<{ ok: boolean }>(`/api/v1/services/${encodeURIComponent(id)}`, { method: "DELETE" });

  // sessions / presentation
  sessions = () => this.req<PresentationSession[]>("/api/v1/sessions");
  session = (id: string) => this.req<PresentationSession>(`/api/v1/sessions/${encodeURIComponent(id)}`);
  saveSession = (s: PresentationSession) =>
    this.req<PresentationSession>(`/api/v1/sessions/${encodeURIComponent(s.id)}`, { method: "PUT", body: s });
  sessionSlide = (id: string) =>
    this.req<SlideResponse>(`/api/v1/sessions/${encodeURIComponent(id)}/slide`);
  navigate = (id: string, action: "next" | "prev" | "first" | "last" | "jump", index?: number) =>
    this.req<{ position: PresentationSession["position"]; slide: number; total: number }>(
      `/api/v1/sessions/${encodeURIComponent(id)}/navigate`,
      { method: "POST", body: { action, index } },
    );
  blank = (id: string, blanked: boolean) =>
    this.req<{ blanked: boolean }>(`/api/v1/sessions/${encodeURIComponent(id)}/blank`, {
      method: "POST",
      body: { blanked },
    });
  control = (id: string, take: boolean) =>
    this.req<{ controlOwner: string | null }>(`/api/v1/sessions/${encodeURIComponent(id)}/control`, {
      method: "POST",
      body: { take },
    });
  guestToken = (sessionId: string, scopes: string[] = ["view"]) =>
    this.req<{ token: string }>("/api/v1/auth/guest", { method: "POST", body: { sessionId, scopes } });

  // import
  importPreview = (files: ImportFilePayload[]) =>
    this.req<ImportPreview>("/api/v1/import/opensong/preview", { method: "POST", body: { files } });
  importRun = (files: ImportFilePayload[], onDuplicate: "skip" | "replace" | "import") =>
    this.req<ImportReport>("/api/v1/import/opensong", {
      method: "POST",
      body: { files, onDuplicate },
    });
}

export const api = new Api();
