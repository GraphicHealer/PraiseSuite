import { useEffect, useState, type ReactNode } from "react";
import type { Service, ServiceItem, ServiceItemId, SongSummary } from "@praisesuite/core";
import { api } from "../api.js";
import { PrintPreview } from "../PrintPreview.js";

const btn =
  "rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800";

function newItem(patch: Partial<ServiceItem>): ServiceItem {
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

function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function ServicesPage({ onOpenSong }: { onOpenSong: (id: string) => void }): ReactNode {
  const [services, setServices] = useState<Service[]>([]);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [current, setCurrent] = useState<Service | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const [bibles, setBibles] = useState<{ id: string; name: string; abbreviation: string }[]>([]);
  const [bibleId, setBibleId] = useState("");
  const [refText, setRefText] = useState("");

  const reload = () => api.services().then(setServices).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void reload();
    api.songs().then(setSongs).catch(() => {});
    api.bibles().then(setBibles).catch(() => {});
  }, []);

  const addScripture = async () => {
    if (!current || !bibleId || !refText.trim()) return;
    try {
      const p = await api.passage(bibleId, refText.trim());
      patch({
        items: [
          ...current.items,
          newItem({ kind: "scripture", title: p.title, slides: p.slides }),
        ],
      });
      setRefText("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const create = async () => {
    const name = prompt("Service name:", "Sunday Morning");
    if (!name) return;
    const service: Service = {
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
      items: [],
    };
    await api.saveService(service);
    setCurrent(service);
    void reload();
  };

  const patch = (p: Partial<Service>) => {
    setCurrent((s) => (s ? { ...s, ...p } : s));
    setDirty(true);
  };

  const save = async () => {
    if (!current) return;
    await api.saveService(current);
    setDirty(false);
    void reload();
  };

  if (!current) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Services</h1>
          <button onClick={() => void create()} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500">
            + New service
          </button>
        </div>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {services.map((s) => (
            <li key={s.id}>
              <button onClick={() => setCurrent(s)} className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-zinc-500">{s.date ?? ""}</span>
                <span className="ml-auto text-xs text-zinc-400">{s.items.length} items</span>
              </button>
            </li>
          ))}
          {services.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">No services yet.</li>}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      {printUrl && <PrintPreview url={printUrl} onClose={() => setPrintUrl(null)} />}
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => { setCurrent(null); setDirty(false); }} className={btn}>← Services</button>
        <input className={`${input} text-lg font-semibold`} value={current.name} onChange={(e) => patch({ name: e.target.value })} />
        <input type="date" className={input} value={current.date ?? ""} onChange={(e) => patch({ date: e.target.value || null })} />
        <button
          onClick={() => setPrintUrl(api.printUrl(`/api/v1/print/service/${encodeURIComponent(current.id)}`))}
          className={btn}
          title="Printable set list"
        >
          Print set
        </button>
        <button onClick={() => void save()} className="ml-auto rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500">
          {dirty ? "Save" : "Saved"}
        </button>
      </div>

      <ol className="space-y-1">
        {current.items.map((item, i) => (
          <li key={item.id} className="flex items-center gap-2 rounded border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="w-4 text-xs text-zinc-400">{i + 1}</span>
            <span className="rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">{item.kind}</span>
            {item.kind === "song" && item.songId ? (
              <button onClick={() => onOpenSong(item.songId!)} className="text-indigo-600 hover:underline">{item.title}</button>
            ) : (
              <input className={`${input} flex-1`} value={item.title} onChange={(e) => patch({ items: current.items.map((it, j) => (j === i ? { ...it, title: e.target.value } : it)) })} />
            )}
            <div className="ml-auto flex gap-1">
              <button onClick={() => patch({ items: move(current.items, i, -1) })} className={btn}>↑</button>
              <button onClick={() => patch({ items: move(current.items, i, 1) })} className={btn}>↓</button>
              <button onClick={() => patch({ items: current.items.filter((_, j) => j !== i) })} className={`${btn} text-red-600`}>×</button>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={input}
          value=""
          onChange={(e) => {
            const s = songs.find((x) => x.id === e.target.value);
            if (s) patch({ items: [...current.items, newItem({ kind: "song", songId: s.id as ServiceItem["songId"], title: s.title })] });
          }}
        >
          <option value="">+ Add song…</option>
          {songs.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        <button
          onClick={() => patch({ items: [...current.items, newItem({ kind: "custom-slides", title: "Custom slide", slides: [{ body: "" }] })] })}
          className={btn}
        >
          + Custom slides
        </button>
        <button
          onClick={() => patch({ items: [...current.items, newItem({ kind: "note", title: "Note" })] })}
          className={btn}
        >
          + Note
        </button>
        <span className="mx-1 text-xs text-zinc-500">Scripture:</span>
        <select className={input} value={bibleId} onChange={(e) => setBibleId(e.target.value)}>
          <option value="">translation…</option>
          {bibles.map((b) => (
            <option key={b.id} value={b.id}>{b.abbreviation} — {b.name}</option>
          ))}
        </select>
        <input
          className={`${input} w-40`}
          placeholder="John 3:16-18"
          value={refText}
          onChange={(e) => setRefText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addScripture()}
        />
        <button disabled={!bibleId || !refText.trim()} onClick={() => void addScripture()} className={`${btn} disabled:opacity-50`}>
          + Add
        </button>
      </div>
    </div>
  );
}
