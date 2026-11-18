import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Service, ServiceItem, ServiceItemId, SongSummary } from "@praisesuite/core";
import { api } from "../api.js";
import { PrintPreview } from "../PrintPreview.js";
import { SongEditorPage } from "./SongEditorPage.js";

const btn =
  "rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";
const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800";
const grp = "flex flex-col gap-1 rounded border border-zinc-200 p-2 dark:border-zinc-800";
const grpLabel = "text-xs font-semibold uppercase tracking-wide text-zinc-500";

/**
 * OpenSong MainWindow parity: Songs/Sets mode toggle with the song editor
 * embedded in the main window. Buttons map to OpenSong's control groups —
 * "Selected Song" / "New Song" / "All Songs" in Songs mode; "Current Set" /
 * "Current Item" / "New Item" in Sets mode.
 */
export function MainPage({
  onPresentService,
  onImport,
}: {
  onPresentService: (service: Service, itemId?: string) => void;
  onImport: () => void;
}): ReactNode {
  const [mode, setMode] = useState<"songs" | "sets">("songs");
  const [printUrl, setPrintUrl] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-53px)] flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <button
          onClick={() => setMode("songs")}
          className={`rounded px-4 py-1 text-sm font-medium ${mode === "songs" ? "bg-indigo-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          Songs
        </button>
        <button
          onClick={() => setMode("sets")}
          className={`rounded px-4 py-1 text-sm font-medium ${mode === "sets" ? "bg-indigo-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          Sets
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "songs" ? (
          <SongsMode onPresentService={onPresentService} onImport={onImport} setPrintUrl={setPrintUrl} />
        ) : (
          <SetsMode onPresentService={onPresentService} setPrintUrl={setPrintUrl} />
        )}
      </div>
      {printUrl && <PrintPreview url={printUrl} filename="document.pdf" onClose={() => setPrintUrl(null)} />}
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

  const allFolders = useMemo(
    () => [...new Set([...folders, ...songs.map((s) => s.folder).filter((f): f is string => f !== null)])].sort(),
    [folders, songs],
  );
  const list = folder === null ? songs : songs.filter((s) => s.folder === folder);

  const addFolder = async () => {
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    await api.req("/api/v1/folders", { method: "POST", body: { name: name.trim() } }).catch(() => {});
    void reloadFolders();
  };
  const deleteFolder = async () => {
    if (folder === null) return;
    if (!confirm(`Delete folder "${folder}"? Songs inside move to the library root.`)) return;
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

  /** OpenSong "Present" on a song: wrap it in a one-item service and go live. */
  const presentSong = async (songId: string) => {
    const song = await api.song(songId);
    const svc = makeService(`${song.title}`, [
      makeItem({ kind: "song", songId: song.id as ServiceItem["songId"], title: song.title }),
    ]);
    await api.saveService(svc);
    onPresentService(svc);
  };

  return (
    <div className="flex h-full gap-3 p-3">
      {/* Folders */}
      <aside className="flex w-40 shrink-0 flex-col gap-2">
        <div className={grp}>
          <span className={grpLabel}>Song folders</span>
          <div className="max-h-full overflow-y-auto">
            <button
              onClick={() => setFolder(null)}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${folder === null ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
            >
              All songs
            </button>
            {allFolders.map((f) => (
              <button
                key={f}
                onClick={() => setFolder(f)}
                className={`block w-full truncate rounded px-2 py-1 text-left text-sm ${folder === f ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button onClick={() => void addFolder()} className={btn} title="Add folder">+</button>
            <button onClick={() => void deleteFolder()} disabled={folder === null} className={btn} title="Delete folder">−</button>
          </div>
        </div>
      </aside>

      {/* Song list + All Songs / New Song groups */}
      <div className="flex w-64 shrink-0 flex-col gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find…"
          className={input}
          title="Find songs (All Songs → Find)"
        />
        <ul className="min-h-0 flex-1 divide-y divide-zinc-200 overflow-y-auto rounded border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {list.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setSel(s.id)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${sel === s.id ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
              >
                <span className="font-medium">{s.title}</span>
                <span className="truncate text-xs text-zinc-500">{s.authors.join(", ")}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">No songs.</li>}
        </ul>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <div className={grp}>
            <span className={grpLabel}>New song</span>
            <button onClick={() => void create()} className={btn}>Create</button>
            <button onClick={onImport} className={btn}>Import…</button>
          </div>
          <div className={grp}>
            <span className={grpLabel}>All songs</span>
            <button onClick={() => setPrintUrl(api.printUrl("/api/v1/print/songbook"))} className={btn}>Print</button>
            <button onClick={exportAll} className={btn}>Export</button>
            <button onClick={() => setPrintUrl(api.printUrl("/api/v1/print/activity"))} className={btn}>CCLI report</button>
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
  const [services, setServices] = useState<Service[]>([]);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [current, setCurrent] = useState<Service | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<ServiceItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [bibles, setBibles] = useState<{ id: string; name: string; abbreviation: string }[]>([]);
  const [error, setError] = useState("");
  const [showAddScripture, setShowAddScripture] = useState(false);
  const [bibleId, setBibleId] = useState("");
  const [refText, setRefText] = useState("");

  const reload = () => api.services().then(setServices).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void reload();
    api.songs().then(setSongs).catch(() => {});
    api.bibles().then(setBibles).catch(() => {});
  }, []);

  const open = (s: Service) => { setCurrent(s); setSel(null); setDirty(false); };
  const patch = (p: Partial<Service>) => { setCurrent((s) => (s ? { ...s, ...p } : s)); setDirty(true); };
  const save = async () => {
    if (!current) return;
    await api.saveService(current);
    setDirty(false);
    void reload();
  };

  // ── Current Set ──
  const createSet = async () => {
    const name = prompt("Set name:", "Sunday Morning");
    if (!name) return;
    const svc = makeService(name, []);
    await api.saveService(svc);
    open(svc);
    void reload();
  };
  const deleteSet = async () => {
    if (!current || !confirm(`Delete set "${current.name}"?`)) return;
    await api.deleteService(current.id);
    setCurrent(null);
    void reload();
  };
  const renameSet = () => {
    if (!current) return;
    const name = prompt("Rename set:", current.name);
    if (name) patch({ name });
  };
  const saveAs = async () => {
    if (!current) return;
    const name = prompt("Save set as:", `${current.name} copy`);
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

  // ── New Item ──
  const addSong = (songId: string) => {
    const s = songs.find((x) => x.id === songId);
    if (current && s) patchItems([...current.items, makeItem({ kind: "song", songId: s.id as ServiceItem["songId"], title: s.title })]);
  };
  const addScripture = async () => {
    if (!current || !bibleId || !refText.trim()) return;
    try {
      const p = await api.passage(bibleId, refText.trim());
      patchItems([...current.items, makeItem({ kind: "scripture", title: p.title, slides: p.slides })]);
      setRefText("");
      setShowAddScripture(false);
    } catch (e) { setError((e as Error).message); }
  };
  const addSlides = () =>
    current && patchItems([...current.items, makeItem({ kind: "custom-slides", title: "Custom slide", slides: [{ body: "" }] })]);
  const addStyle = () =>
    current && patchItems([...current.items, makeItem({ kind: "note", title: "Style change", config: { style: {} } })]);
  const addImage = async (file: File) => {
    if (!current) return;
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]!);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const m = await api.uploadMedia(file.name, file.type || "image/png", dataUrl);
    patchItems([...current.items, makeItem({ kind: "media", title: file.name, mediaAssetId: m.storageKey as ServiceItem["mediaAssetId"], config: { assetKeys: [m.storageKey] } })]);
  };
  const addExternal = () => {
    const url = prompt("External file path or URL:");
    if (current && url) patchItems([...current.items, makeItem({ kind: "note", title: url, config: { external: url } })]);
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
                onClick={() => open(s)}
                className={`block w-full rounded px-2 py-1 text-left text-sm ${current?.id === s.id ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                {s.name}
                <span className="ml-1 text-xs text-zinc-400">{s.items.length}</span>
              </button>
            ))}
          </div>
          <button onClick={() => void createSet()} className={btn}>+ New set</button>
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
                <li key={it.id}>
                  <button
                    onClick={() => setSel(i)}
                    className={`flex w-full items-center gap-2 rounded border px-3 py-1.5 text-left text-sm ${
                      sel === i ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="w-5 text-xs text-zinc-400">{i + 1}</span>
                    <span className="rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">{it.kind}</span>
                    <span className="truncate">{it.title || <span className="text-zinc-400">(untitled)</span>}</span>
                  </button>
                </li>
              ))}
            </ol>
            {error && <p className="text-xs text-red-600">{error}</p>}

            {showAddScripture && (
              <div className="flex items-center gap-2 rounded border border-zinc-300 p-2 dark:border-zinc-700">
                <select className={input} value={bibleId} onChange={(e) => setBibleId(e.target.value)}>
                  <option value="">translation…</option>
                  {bibles.map((b) => (
                    <option key={b.id} value={b.id}>{b.abbreviation} — {b.name}</option>
                  ))}
                </select>
                <input
                  className={`${input} flex-1`}
                  placeholder="John 3:16-18"
                  value={refText}
                  onChange={(e) => setRefText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addScripture()}
                  autoFocus
                />
                <button disabled={!bibleId || !refText.trim()} onClick={() => void addScripture()} className={btn}>Add</button>
                <button onClick={() => setShowAddScripture(false)} className={btn}>Cancel</button>
              </div>
            )}

            {/* New Item group */}
            <div className={grp}>
              <span className={grpLabel}>New item</span>
              <div className="flex flex-wrap gap-1">
                <select className={input} value="" onChange={(e) => addSong(e.target.value)}>
                  <option value="">Add song…</option>
                  {songs.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
                <button onClick={() => setShowAddScripture(true)} className={btn}>Scripture</button>
                <button onClick={addSlides} className={btn}>Slides</button>
                <button onClick={addStyle} className={btn}>Style</button>
                <label className={`${btn} cursor-pointer`}>
                  Image
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ""; }} />
                </label>
                <button onClick={addExternal} className={btn}>External</button>
              </div>
            </div>
          </div>

          {/* Current Set + Current Item groups */}
          <aside className="flex w-44 shrink-0 flex-col gap-2">
            <div className={grp}>
              <span className={grpLabel}>Current set</span>
              <button onClick={() => void presentSet()} className={btn}>Present</button>
              <button onClick={renameSet} className={btn}>Rename</button>
              <button onClick={() => void save()} className={btn}>{dirty ? "Save" : "Save"}</button>
              <button onClick={() => void saveAs()} className={btn}>Save As…</button>
              <button onClick={() => setPrintUrl(api.printUrl(`/api/v1/print/service/${encodeURIComponent(current.id)}/songs`))} className={btn}>Print Songs</button>
              <button onClick={() => setPrintUrl(api.printUrl(`/api/v1/print/service/${encodeURIComponent(current.id)}`))} className={btn}>Print Order</button>
              <button onClick={exportSet} className={btn}>Export</button>
              <button onClick={() => void deleteSet()} className={`${btn} text-red-600`}>Delete</button>
            </div>
            <div className={grp}>
              <span className={grpLabel}>Current item</span>
              <button disabled={sel === null} onClick={() => item && void presentSet(item.id)} className={btn}>Present Item</button>
              <button disabled={sel === null} onClick={() => sel !== null && patchItems(moveItem(current.items, sel, -1))} className={btn}>Move Up</button>
              <button disabled={sel === null} onClick={() => sel !== null && patchItems(moveItem(current.items, sel, 1))} className={btn}>Move Down</button>
              <button disabled={sel === null} onClick={copyItem} className={btn}>Copy</button>
              <button disabled={clipboard === null} onClick={pasteItem} className={btn}>Paste</button>
              <button disabled={sel === null} onClick={storeItem} className={btn}>Store</button>
              <button disabled={sel === null} onClick={() => sel !== null && patchItems(current.items.filter((_, j) => j !== sel))} className={`${btn} text-red-600`}>Remove</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
