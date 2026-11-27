import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Service, ServiceItem, ServiceItemId, SlideStyle, SlideStyleOverride, SongId, SongSummary } from "@praisesuite/core";
import {
  mdiArrowDown, mdiArrowUp, mdiBookOpenPageVariant, mdiCardTextOutline, mdiContentCopy,
  mdiContentPaste, mdiContentSave, mdiContentSaveEdit, mdiDelete, mdiExport, mdiFileChartOutline,
  mdiFilePlusOutline, mdiFolderMinus, mdiFolderPlus, mdiFormatClear, mdiImageOutline, mdiImport,
  mdiMagnify, mdiMusicNote, mdiMusicNotePlus, mdiPaletteOutline, mdiPencil, mdiPlay,
  mdiPlaylistMusic, mdiPlaylistPlus, mdiPresentationPlay, mdiPrinter, mdiRenameBox,
} from "@mdi/js";
import { api } from "../api.js";
import { AddItemDialog, type AddItemTab } from "../components/AddItemDialog.js";
import { useDialog } from "../components/Dialog.js";
import { Icon } from "../components/Icon.js";
import { ItemEditor } from "../components/ItemEditor.js";
import { StyleEditor } from "../components/StyleEditor.js";
import { openPrintPreview } from "../PrintPreview.js";
import { SongEditorPage } from "./SongEditorPage.js";

const btn =
  "rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";
const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800";
const grp = "flex flex-col gap-1 rounded border border-zinc-200 p-2 dark:border-zinc-800";
const grpLabel = "text-xs font-semibold uppercase tracking-wide text-zinc-500";
/** Reused service for ad-hoc "Present song" — one entry in Sets, not one per song. */
const SCRATCH_SET_NAME = "(Presented Song)";

/**
 * OpenSong MainWindow parity: Songs/Sets mode toggle with the song editor
 * embedded in the main window. Buttons map to OpenSong's control groups —
 * "Selected Song" / "New Song" / "All Songs" in Songs mode; "Current Set" /
 * "Current Item" / "New Item" in Sets mode.
 */
export function MainPage({
  mode,
  onModeChange,
  onPresentService,
  onImport,
}: {
  mode: "songs" | "sets";
  onModeChange: (m: "songs" | "sets") => void;
  onPresentService: (service: Service, itemId?: string) => void;
  onImport: () => void;
}): ReactNode {
  // Print buttons open the standalone preview window (Chrome-style popup).
  const setPrintUrl = (url: string | null) => {
    if (url !== null) openPrintPreview({ url });
  };

  return (
    <div className="flex h-[calc(100vh-53px)] flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <button
          onClick={() => onModeChange("songs")}
          className={`rounded px-4 py-1 text-sm font-medium ${mode === "songs" ? "bg-indigo-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          <Icon path={mdiMusicNote} /> Song Mode
        </button>
        <button
          onClick={() => onModeChange("sets")}
          className={`rounded px-4 py-1 text-sm font-medium ${mode === "sets" ? "bg-indigo-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          <Icon path={mdiPlaylistMusic} /> Set Mode
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "songs" ? (
          <SongsMode onPresentService={onPresentService} onImport={onImport} setPrintUrl={setPrintUrl} />
        ) : (
          <SetsMode onPresentService={onPresentService} setPrintUrl={setPrintUrl} />
        )}
      </div>
    </div>
  );
}

/* ── Songs mode ─────────────────────────────────────────────────────── */

function SongsMode({
  onPresentService,
  onImport,
  setPrintUrl,
}: {
  onPresentService: (service: Service, itemId?: string) => void;
  onImport: () => void;
  setPrintUrl: (url: string | null) => void;
}): ReactNode {
  const dlg = useDialog();
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reloadSongs = () =>
    api.songs(query || undefined).then(setSongs).catch((e) => setError((e as Error).message));
  const reloadFolders = () =>
    api.req<{ folders: string[] }>("/api/v1/folders").then((f) => setFolders(f.folders)).catch(() => {});

  useEffect(() => {
    const t = setTimeout(() => void reloadSongs(), 200);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => void reloadFolders(), []);
  // D16: pick up changes made by other clients/windows (import, presenter, receivers).
  useEffect(() => {
    const refresh = () => { void reloadSongs(); void reloadFolders(); };
    window.addEventListener("focus", refresh);
    const t = setInterval(refresh, 15000);
    return () => { window.removeEventListener("focus", refresh); clearInterval(t); };
  }, []);

  const allFolders = useMemo(
    () => [...new Set([...folders, ...songs.map((s) => s.folder).filter((f): f is string => f !== null)])].sort(),
    [folders, songs],
  );
  const list = folder === null ? songs : songs.filter((s) => s.folder === folder);

  const addFolder = async () => {
    const name = await dlg.prompt("New folder name:");
    if (!name?.trim()) return;
    await api.req("/api/v1/folders", { method: "POST", body: { name: name.trim() } }).catch(() => {});
    void reloadFolders();
  };
  const deleteFolder = async () => {
    if (folder === null) return;
    if (!(await dlg.confirm(`Delete folder "${folder}"? Songs inside move to the library root.`))) return;
    await api.req(`/api/v1/folders/${encodeURIComponent(folder)}`, { method: "DELETE" }).catch(() => {});
    setFolder(null);
    void reloadFolders();
    void reloadSongs();
  };

  const create = async () => {
    const s = await api.createSong("New Song");
    if (folder !== null) {
      const song = await api.song(s.id);
      song.folder = folder;
      await api.saveSong(song);
      void reloadSongs();
    }
    setSel(s.id);
  };

  const exportAll = () => {
    const a = document.createElement("a");
    a.href = api.printUrl("/api/v1/export/songs");
    a.download = "songs.zip";
    a.click();
  };

  /** OpenSong "Present" on a song: reuse ONE scratch service (D10 — ad-hoc
   * presentation shouldn't clutter the Sets list with one-item sets). */
  const presentSong = async (songId: string) => {
    const song = await api.song(songId);
    const existing = await api.services().catch(() => [] as Service[]);
    const scratch = existing.find((s) => s.name === SCRATCH_SET_NAME);
    const svc: Service = scratch
      ? { ...scratch, name: SCRATCH_SET_NAME, items: [] }
      : makeService(SCRATCH_SET_NAME, []);
    svc.items = [
      makeItem({ kind: "song", songId: song.id as ServiceItem["songId"], title: song.title }),
    ];
    await api.saveService(svc);
    onPresentService(svc);
  };

  return (
    <div className="flex h-full gap-3 p-3">
      {/* OpenSong songs pane: Folders dropdown -> "Songs:" label -> song list */}
      <div className="flex w-72 shrink-0 flex-col gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <span className="font-semibold">Folders:</span>
          <select
            value={folder ?? ""}
            onChange={(e) => setFolder(e.target.value === "" ? null : e.target.value)}
            className={`${input} min-w-0 flex-1`}
          >
            <option value="">(All)</option>
            {allFolders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <button onClick={() => void addFolder()} className={btn} title="Add folder"><Icon path={mdiFolderPlus} /></button>
          <button onClick={() => void deleteFolder()} disabled={folder === null} className={btn} title="Delete folder"><Icon path={mdiFolderMinus} /></button>
        </label>
        <span className="-mb-1 text-sm font-semibold">Songs:</span>
        <ul className="min-h-0 flex-1 divide-y divide-zinc-200 overflow-y-auto rounded border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {list.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setSel(s.id)}
                title={`${s.title}${s.authors.length > 0 ? ` — ${s.authors.join(", ")}` : ""}`}
                className={`block w-full truncate px-2 py-1 text-left text-sm ${sel === s.id ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
              >
                <span className="font-medium">{s.title}</span>
                {s.authors.length > 0 && (
                  <span className="text-zinc-500"> — {s.authors.join(", ")}</span>
                )}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">No songs.</li>}
        </ul>
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find…"
            className={`${input} w-full pl-7`}
            title="Find songs (All Songs → Find)"
          />
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400">
            <Icon path={mdiMagnify} size={0.7} />
          </span>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <div className={grp}>
            <span className={grpLabel}>New song</span>
            <button onClick={() => void create()} className={btn}><Icon path={mdiFilePlusOutline} /> Create</button>
            <button onClick={onImport} className={btn}><Icon path={mdiImport} /> Import…</button>
          </div>
          <div className={grp}>
            <span className={grpLabel}>All songs</span>
            <button onClick={() => setPrintUrl(api.printUrl("/api/v1/print/songbook"))} className={btn}><Icon path={mdiPrinter} /> Print</button>
            <button onClick={exportAll} className={btn}><Icon path={mdiExport} /> Export</button>
            <button onClick={() => setPrintUrl(api.printUrl("/api/v1/print/activity"))} className={btn}><Icon path={mdiFileChartOutline} /> CCLI report</button>
          </div>
        </div>
      </div>

      {/* Selected song — embedded editor */}
      <div className="min-w-0 flex-1 overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {sel === null ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Select a song, or create/import one.
          </div>
        ) : (
          <SongEditorPage
            id={sel}
            onPresent={(song) => void presentSong(song.id)}
            onCopied={(id) => { void reloadSongs().then(() => setSel(id)); }}
          />
        )}
      </div>
    </div>
  );
}

/* ── Sets mode ──────────────────────────────────────────────────────── */

function makeItem(patch: Partial<ServiceItem>): ServiceItem {
  return {
    id: crypto.randomUUID() as ServiceItemId,
    kind: "song",
    songId: null,
    arrangementId: null,
    mediaAssetId: null,
    title: "",
    subtitle: null,
    notes: null,
    slides: [],
    loopSeconds: 0,
    config: {},
    ...patch,
  };
}

/** Merge an item's stored <style> override over the global style — the
 *  resolved style OpenSong's can_slide_style would display. */
function resolvedItemStyle(global: SlideStyle, ov: SlideStyleOverride | undefined): SlideStyle {
  const o = ov ?? {};
  return {
    ...global,
    ...o,
    title: { ...global.title, ...(o.title ?? {}) },
    body: { ...global.body, ...(o.body ?? {}) },
    subtitle: { ...global.subtitle, ...(o.subtitle ?? {}) },
  };
}

function makeService(name: string, items: ServiceItem[]): Service {
  return {
    id: crypto.randomUUID() as Service["id"],
    revision: {
      id: crypto.randomUUID() as Service["revision"]["id"],
      parentId: null,
      origin: "web",
      createdAt: new Date().toISOString(),
    },
    name,
    date: new Date().toISOString().slice(0, 10),
    description: null,
    items,
  };
}

function moveItem<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function SetsMode({
  onPresentService,
  setPrintUrl,
}: {
  onPresentService: (service: Service, itemId?: string) => void;
  setPrintUrl: (url: string | null) => void;
}): ReactNode {
  const dlg = useDialog();
  const [services, setServices] = useState<Service[]>([]);
  const [current, setCurrent] = useState<Service | null>(null);
  const [sel, setSel] = useState<number | null>(() => {
    const v = Number.parseInt(localStorage.getItem("ps.lastSel") ?? "", 10);
    return Number.isFinite(v) ? v : null;
  });
  const [clipboard, setClipboard] = useState<ServiceItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [addTab, setAddTab] = useState<AddItemTab | null>(null);
  /** Per-item <style> editing (OpenSong can_slide_style → StyleWindow). */
  const [editingItemStyle, setEditingItemStyle] = useState(false);
  /** Per-item edit dialog (pencil) — name/notes/attrs + per-kind overrides. */
  const [editingItem, setEditingItem] = useState<number | null>(null);
  /** songId → key for the key column on song line items. */
  const [songKeys, setSongKeys] = useState<Record<string, string>>({});
  const dragFrom = useRef<number | null>(null);
  useEffect(() => {
    if (!current) { setSongKeys({}); return; }
    const ids = [...new Set(current.items.map((i) => i.songId).filter((x): x is SongId => x !== null))];
    for (const id of ids) {
      if (songKeys[id] !== undefined) continue;
      void api.song(id)
        .then((s) => {
          // Arrangement key wins (OpenSong <key> is per-arrangement), else
          // the song's default key.
          const it = current.items.find((x) => x.songId === id);
          const arr = it?.arrangementId ? s.arrangements?.find((a) => a.id === it.arrangementId) : undefined;
          setSongKeys((m) => ({ ...m, [id]: arr?.key ?? s.defaultKey ?? "" }));
        })
        .catch(() => {});
    }
    // songKeys[id] short-circuits refetches — safe to rerun on any set edit.
  }, [current]);
  const [globalStyle, setGlobalStyle] = useState<SlideStyle | null>(null);
  useEffect(() => {
    void api.style().then((s) => setGlobalStyle(s as unknown as SlideStyle)).catch(() => {});
  }, []);

  const reload = () => api.services().then(setServices).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void reload();
    // OpenSong reopens the last-opened set — remember it across tab switches
    // and app restarts (leaving Sets mode never deselects the current set).
    const last = localStorage.getItem("ps.lastSet");
    if (last) void api.service(last).then((svc) => setCurrent((c) => c ?? svc)).catch(() => {});
  }, []);
  // D16: refresh the set list when the window regains focus (import/external edits).
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    const t = setInterval(onFocus, 20000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, []);

  const open = (s: Service) => {
    localStorage.setItem("ps.lastSet", s.id);
    localStorage.removeItem("ps.lastSel");
    setCurrent(s);
    setSel(null);
    setDirty(false);
  };
  const pick = (i: number | null) => {
    setSel(i);
    if (i === null) localStorage.removeItem("ps.lastSel");
    else localStorage.setItem("ps.lastSel", String(i));
  };
  const openGuarded = (s: Service) => {
    void (async () => {
      if (dirty && current?.id !== s.id && !(await dlg.confirm("Discard unsaved changes?"))) return;
      open(s);
    })();
  };
  const patch = (p: Partial<Service>) => { setCurrent((s) => (s ? { ...s, ...p } : s)); setDirty(true); };
  const save = async () => {
    if (!current) return;
    await api.saveService(current);
    setDirty(false);
    void reload();
  };

  // ── Current Set ──
  const createSet = async () => {
    const name = await dlg.prompt("Set name:", "Sunday Morning");
    if (!name) return;
    const svc = makeService(name, []);
    await api.saveService(svc);
    open(svc);
    void reload();
  };
  const deleteSet = async () => {
    if (!current || !(await dlg.confirm(`Delete set "${current.name}"?`))) return;
    await api.deleteService(current.id);
    setCurrent(null);
    void reload();
  };
  const renameSet = async () => {
    if (!current) return;
    const name = await dlg.prompt("Rename set:", current.name);
    if (name) patch({ name });
  };
  const saveAs = async () => {
    if (!current) return;
    const name = await dlg.prompt("Save set as:", `${current.name} copy`);
    if (!name) return;
    const copy = { ...current, id: crypto.randomUUID() as Service["id"], name };
    await api.saveService(copy);
    open(copy);
    void reload();
  };
  const exportSet = () => {
    if (!current) return;
    const a = document.createElement("a");
    a.href = api.printUrl(`/api/v1/export/service/${encodeURIComponent(current.id)}`);
    a.download = `${current.name}.xml`;
    a.click();
  };

  // ── Current Item ──
  const item = sel !== null ? current?.items[sel] : null;
  const patchItems = (items: ServiceItem[]) => patch({ items });
  const copyItem = () => { if (item) setClipboard({ ...item }); };
  const pasteItem = () => {
    if (!current || !clipboard) return;
    const insert = { ...clipboard, id: crypto.randomUUID() as ServiceItemId };
    const items = [...current.items];
    items.splice((sel ?? items.length - 1) + 1, 0, insert);
    patchItems(items);
  };
  const storeItem = () => { void save(); }; // OpenSong "Store" commits item edits to the set

  const presentSet = async (itemId?: string) => {
    if (!current) return;
    await save();
    onPresentService(current, itemId);
  };

  // ── New Item (OpenSong Song Lookup dialog) ──
  const insertItems = (items: ServiceItem[]) => {
    if (!current) return;
    const list = [...current.items];
    list.splice((sel ?? list.length - 1) + 1, 0, ...items);
    patchItems(list);
  };

  return (
    <div className="flex h-full gap-3 p-3">
      {/* Sets list */}
      <aside className="flex w-44 shrink-0 flex-col gap-2">
        <div className={`${grp} min-h-0 flex-1`}>
          <span className={grpLabel}>Sets</span>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => openGuarded(s)}
                className={`block w-full rounded px-2 py-1 text-left text-sm ${current?.id === s.id ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                {s.name}
                <span className="ml-1 text-xs text-zinc-400">{s.items.length}</span>
              </button>
            ))}
          </div>
          <button onClick={() => void createSet()} className={btn}><Icon path={mdiPlaylistPlus} /> New set</button>
        </div>
      </aside>

      {current === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Select or create a set.</div>
      ) : (
        <>
          {/* Current set items */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <input className={`${input} font-semibold`} value={current.name} onChange={(e) => patch({ name: e.target.value })} />
              <input type="date" className={input} value={current.date ?? ""} onChange={(e) => patch({ date: e.target.value || null })} />
              <span className="text-xs text-zinc-500">{dirty ? "unsaved" : "saved"}</span>
            </div>
            <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {current.items.map((it, i) => (
                <li
                  key={it.id}
                  draggable
                  onDragStart={() => { dragFrom.current = i; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragFrom.current;
                    dragFrom.current = null;
                    if (from === null || from === i) return;
                    const items = [...current.items];
                    const [moved] = items.splice(from, 1);
                    items.splice(i, 0, moved!);
                    patchItems(items);
                    pick(i);
                  }}
                >
                  <button
                    onClick={() => pick(i)}
                    className={`flex w-full items-center gap-2 rounded border px-3 py-1.5 text-left text-sm ${
                      sel === i ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="w-5 text-xs text-zinc-400">{i + 1}</span>
                    <span className="rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">{it.kind}</span>
                    <span className="truncate">{it.title || <span className="text-zinc-400">(untitled)</span>}</span>
                    {it.kind === "song" && it.songId !== null && songKeys[it.songId] ? (
                      <span className="ml-auto shrink-0 rounded bg-emerald-100 px-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        {songKeys[it.songId]}
                        {typeof it.config["transpose"] === "number" && it.config["transpose"] !== 0
                          ? ` ${(it.config["transpose"] as number) > 0 ? "+" : ""}${it.config["transpose"]}`
                          : ""}
                      </span>
                    ) : null}
                    <span
                      role="button"
                      tabIndex={-1}
                      title="Edit item"
                      onClick={(e) => { e.stopPropagation(); setEditingItem(i); }}
                      className="ml-auto shrink-0 rounded px-1 text-xs text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                      style={it.kind === "song" && it.songId !== null && songKeys[it.songId] ? { marginLeft: 0 } : undefined}
                    >
                      <Icon path={mdiPencil} size={0.65} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {error && <p className="text-xs text-red-600">{error}</p>}

            {/* New Item — OpenSong add-to-set dialogs as tabs */}
            <div className={grp}>
              <span className={grpLabel}>New item</span>
              <div className="flex flex-wrap gap-1">
                <button onClick={() => setAddTab("song")} className={btn}><Icon path={mdiMusicNotePlus} /> Add Item…</button>
                <button onClick={() => setAddTab("scripture")} className={btn}><Icon path={mdiBookOpenPageVariant} /> Scripture…</button>
                <button onClick={() => setAddTab("custom")} className={btn}><Icon path={mdiCardTextOutline} /> Slides…</button>
                <button onClick={() => setAddTab("image")} className={btn}><Icon path={mdiImageOutline} /> Image…</button>
                <button onClick={() => setAddTab("style")} className={btn}><Icon path={mdiPaletteOutline} /> Style…</button>
              </div>
            </div>
          </div>

          {addTab !== null && (
            <AddItemDialog tab={addTab} onTabChange={setAddTab} onAdd={insertItems} onClose={() => setAddTab(null)} />
          )}

          {/* Current Set + Current Item groups */}
          <aside className="flex w-44 shrink-0 flex-col gap-2">
            <div className={grp}>
              <span className={grpLabel}>Current set</span>
              <button onClick={() => void presentSet()} className={btn}><Icon path={mdiPresentationPlay} /> Present</button>
              <button onClick={renameSet} className={btn}><Icon path={mdiRenameBox} /> Rename</button>
              <button onClick={() => void save()} className={btn} disabled={!dirty}><Icon path={mdiContentSave} /> {dirty ? "Save*" : "Save"}</button>
              <button onClick={() => void saveAs()} className={btn}><Icon path={mdiContentSaveEdit} /> Save As…</button>
              <button onClick={() => setPrintUrl(api.printUrl(`/api/v1/print/service/${encodeURIComponent(current.id)}/songs`))} className={btn}><Icon path={mdiPrinter} /> Print Songs</button>
              <button onClick={() => setPrintUrl(api.printUrl(`/api/v1/print/service/${encodeURIComponent(current.id)}`))} className={btn}><Icon path={mdiPrinter} /> Print Order</button>
              <button onClick={exportSet} className={btn}><Icon path={mdiExport} /> Export</button>
              <button onClick={() => void deleteSet()} className={`${btn} text-red-600`}><Icon path={mdiDelete} /> Delete</button>
            </div>
            <div className={grp}>
              <span className={grpLabel}>Current item</span>
              <button disabled={sel === null} onClick={() => item && void presentSet(item.id)} className={btn}><Icon path={mdiPlay} /> Present Item</button>
              <button disabled={sel === null} onClick={() => sel !== null && patchItems(moveItem(current.items, sel, -1))} className={btn}><Icon path={mdiArrowUp} /> Move Up</button>
              <button disabled={sel === null} onClick={() => sel !== null && patchItems(moveItem(current.items, sel, 1))} className={btn}><Icon path={mdiArrowDown} /> Move Down</button>
              <button disabled={sel === null} onClick={copyItem} className={btn}><Icon path={mdiContentCopy} /> Copy</button>
              <button disabled={clipboard === null} onClick={pasteItem} className={btn}><Icon path={mdiContentPaste} /> Paste</button>
              <button disabled={sel === null} onClick={storeItem} className={btn}><Icon path={mdiContentSave} /> Store</button>
              <button disabled={sel === null} onClick={() => setEditingItemStyle(true)} className={btn} title="Edit this item's slide style (OpenSong can_slide_style)"><Icon path={mdiPaletteOutline} /> Style…</button>
              {item !== null && item !== undefined && item.config["style"] !== undefined && (
                <button
                  onClick={() => {
                    if (sel === null) return;
                    const it = { ...item, config: { ...item.config } };
                    delete it.config["style"];
                    patchItems(current.items.map((x, i) => (i === sel ? it : x)));
                  }}
                  className={`${btn} text-red-600`}
                  title="Remove this item's style override"
                >
                  <Icon path={mdiFormatClear} /> Clear Style
                </button>
              )}
              <button disabled={sel === null} onClick={() => sel !== null && patchItems(current.items.filter((_, j) => j !== sel))} className={`${btn} text-red-600`}><Icon path={mdiDelete} /> Remove</button>
            </div>
          </aside>

          {/* Pencil edit: per-item overrides (transpose, resize, attrs…). */}
          {editingItem !== null && current.items[editingItem] !== undefined && (
            <ItemEditor
              item={current.items[editingItem]!}
              globalStyle={globalStyle}
              songKey={current.items[editingItem]!.songId !== null ? songKeys[current.items[editingItem]!.songId!] : undefined}
              onSave={(it) => patchItems(current.items.map((x, i) => (i === editingItem ? it : x)))}
              onClose={() => setEditingItem(null)}
            />
          )}

          {/* OpenSong can_slide_style → StyleWindow on the item's <style>. */}
          {editingItemStyle && item !== null && item !== undefined && globalStyle !== null && (
            <StyleEditor
              style={resolvedItemStyle(globalStyle, item.config["style"] as SlideStyleOverride | undefined)}
              heading={`Style Editor — ${item.title || "Item"}`}
              onClose={() => setEditingItemStyle(false)}
              onSave={(s) => {
                if (sel === null) return;
                const it = { ...item, config: { ...item.config, style: s } };
                patchItems(current.items.map((x, i) => (i === sel ? it : x)));
                setEditingItemStyle(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
