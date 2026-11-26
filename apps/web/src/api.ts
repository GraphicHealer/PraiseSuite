import type { PluginManifest, PresentationSession, Service, Song, SongSummary } from "@praisesuite/core";
import type { SlideStyle } from "./slide-types.js";

/** Output modes matching OpenSong's PresentHelperWindow: [N/K/W/H/L/F]. */
export type PresentMode = "normal" | "blank" | "white" | "hidden" | "logo" | "freeze";

export interface SlideResponse {
  sessionId: string;
  status: string;
  blanked: boolean;
  mode: PresentMode;
  alert: string | null;
  slide: {
    index: number;
    total: number;
    title: string;
    lines: string[];
    /** Bilingual (L) sections: per-line language 1|2. */
    langs?: (1 | 2)[];
    kind: string;
    style: SlideStyle;
    mediaKey: string | null;
    backgroundKey: string | null;
    backgroundAsText?: boolean;
    logoKey: string | null;
    loopSeconds: number | null;
    subtitle: string | null;
    emphasize: boolean;
    seconds: number;
    loop: boolean;
    transition: number;
    verseMap: { prev: string[]; curr: string; rest: string[] } | null;
    imageResize: string | null;
    imageKeepAspect: boolean;
    mouseCursor?: string;
    next: {
      title: string;
      lines: string[];
      langs?: (1 | 2)[];
      kind: string;
      blank: boolean;
      mediaKey: string | null;
      backgroundKey: string | null;
      style: SlideStyle;
      subtitle: string | null;
    } | null;
  } | null;
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
  bibles: { path: string; name: string }[];
  skipped: { path: string; reason: string }[];
  duplicates: number;
}

export interface ImportReport {
  importedSongs: number;
  importedSets: number;
  importedBibles?: number;
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

  /** Absolute URL for a server-side rendered document (print pages). */
  printUrl(path: string): string {
    return this.token ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.token)}` : path;
  }

  // server network / sync
  network = () => this.req<{ lanEnabled: boolean; addresses: string[]; port: number | null }>("/api/v1/server/network");
  setNetwork = (lanEnabled: boolean) =>
    this.req<{ lanEnabled: boolean; addresses: string[]; port: number | null }>("/api/v1/server/network", {
      method: "POST",
      body: { lanEnabled },
    });

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
  endSession = (id: string) =>
    this.req<PresentationSession>(`/api/v1/sessions/${encodeURIComponent(id)}/end`, { method: "POST" });
  sessionSlide = (id: string) =>
    this.req<SlideResponse>(`/api/v1/sessions/${encodeURIComponent(id)}/slide`);
  sessionPlan = (id: string) =>
    this.req<{
      slides: {
        index: number;
        itemId: string;
        itemTitle: string;
        itemKind: string;
        slideInItem: number;
        firstLine: string;
        sectionLabel: string | null;
        prefix: string | null;
        slideId: string | null;
        sectionInstanceId: string | null;
        loopSeconds: number;
        itemNotes: string | null;
        blank: boolean;
        seconds: number;
        loop: boolean;
        transition: number;
        emphasize: boolean;
      }[];
      current: number;
      total: number;
    }>(`/api/v1/sessions/${encodeURIComponent(id)}/plan`);
  navigate = (
    id: string,
    action: "next" | "prev" | "first" | "last" | "jump" | "item",
    index?: number,
    itemId?: string,
  ) =>
    this.req<{ position: PresentationSession["position"]; slide: number; total: number }>(
      `/api/v1/sessions/${encodeURIComponent(id)}/navigate`,
      { method: "POST", body: { action, index, itemId } },
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
  setMode = (id: string, mode: PresentMode) =>
    this.req<{ mode: string }>(`/api/v1/sessions/${encodeURIComponent(id)}/mode`, {
      method: "POST",
      body: { mode },
    });
  setAlert = (id: string, message: string | null) =>
    this.req<{ alert: string | null }>(`/api/v1/sessions/${encodeURIComponent(id)}/alert`, {
      method: "POST",
      body: { message },
    });
  setCustom = (id: string, lines: string[] | null) =>
    this.req<{ custom: string[] | null }>(`/api/v1/sessions/${encodeURIComponent(id)}/custom`, {
      method: "POST",
      body: { lines },
    });

  // plugins
  plugins = () => this.req<PluginManifest[]>("/api/v1/plugins");
  fetchBible = (url: string) =>
    this.req<{ id: string; name: string }>("/api/v1/bibles/fetch", { method: "POST", body: { url } });
  pluginCommand = (pluginId: string, command: string, payload?: unknown) =>
    this.req<unknown>(
      `/api/v1/plugins/${encodeURIComponent(pluginId)}/commands/${encodeURIComponent(command)}`,
      { method: "POST", body: payload ?? {} },
    );

  // settings (generic key/value)
  setting = <T = unknown>(key: string) =>
    this.req<{ key: string; value: T | null }>(`/api/v1/settings/${encodeURIComponent(key)}`);
  saveSetting = (key: string, value: unknown) =>
    this.req<{ key: string; value: unknown }>(`/api/v1/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: { value },
    });

  // styles
  style = () => this.req<SlideStyle & { userFieldLabels?: string[] }>("/api/v1/style");
  saveStyle = (style: SlideStyle) =>
    this.req<SlideStyle>("/api/v1/style", { method: "PUT", body: style as unknown as Record<string, unknown> });
  scriptureStyle = () => this.req<SlideStyle>("/api/v1/style/scripture");
  /** Named styles for set style items: built-ins + saved + per-song <style>s. */
  stylesList = () =>
    this.req<{
      presets: { id: string; name: string; style: SlideStyle }[];
      saved: { name: string; style: SlideStyle }[];
      songs: { id: string; title: string; style: SlideStyle }[];
    }>("/api/v1/styles");
  /** Save a style into the named style library ("Saved styles" in pickers). */
  saveNamedStyle = (name: string, style: SlideStyle) =>
    this.req<{ name: string; style: SlideStyle }>(`/api/v1/styles/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: style as unknown as Record<string, unknown>,
    });
  saveScriptureStyle = (style: SlideStyle) =>
    this.req<SlideStyle>("/api/v1/style/scripture", { method: "PUT", body: style as unknown as Record<string, unknown> });
  /** Seed OpenSong's bundled defaults; styles=false adds background images only. */
  openSongDefaults = (styles: boolean) =>
    this.req<{ media: string[] }>("/api/v1/defaults/opensong", { method: "POST", body: { styles } });

  /** Record a song activity (printed/copied) — fired by print/export actions. */
  logSongActivity = (id: string, action: number) =>
    this.req(`/api/v1/songs/${encodeURIComponent(id)}/log?action=${action}`, { method: "POST" }).catch(() => {});
  importOpenSongSettings = (presentSettings?: string, printSettings?: string, mainSettings?: string) =>
    this.req<{ warnings: string[]; media: string[]; printRoles: string[] }>(
      "/api/v1/import/opensong/settings",
      { method: "POST", body: { presentSettings, printSettings, mainSettings } },
    );

  // bibles / media
  bibles = () => this.req<{ id: string; name: string; abbreviation: string; books: number; copyright: string | null }[]>("/api/v1/bibles");
  bible = (id: string) => this.req<{ name: string; books: { number: number; name: string; chapters: string[][] }[] }>(`/api/v1/bibles/${encodeURIComponent(id)}`);
  importBibleXml = (xml: string) =>
    this.req<{ id: string; name: string }>("/api/v1/bibles", { method: "POST", body: { format: "opensong", xml } });
  deleteBible = (id: string) =>
    this.req<{ ok: boolean }>(`/api/v1/bibles/${encodeURIComponent(id)}`, { method: "DELETE" });
  passage = (id: string, ref: string) =>
    this.req<{ title: string; slides: { body: string }[]; copyright: string | null }>(
      `/api/v1/bibles/${encodeURIComponent(id)}/passage?ref=${encodeURIComponent(ref)}`,
    );
  mediaList = () =>
    this.req<{ storageKey: string; mediaType: string; originalFilename: string | null; size: number }[]>(
      "/api/v1/media",
    );
  uploadMedia = (name: string, mediaType: string, dataBase64: string) =>
    this.req<{ storageKey: string }>("/api/v1/media", {
      method: "POST",
      body: { name, mediaType, dataBase64 },
    });

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

/**
 * Read a text file honoring its XML encoding declaration — OpenSong Bible
 * and song files are often ISO-8859-1, which f.text() (UTF-8) mangles.
 */
export async function readXmlFile(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
  const latin = /encoding=["'](?:iso-8859-1|windows-1252|latin1)["']/i.test(head);
  return new TextDecoder(latin ? "windows-1252" : "utf-8").decode(buf);
}
