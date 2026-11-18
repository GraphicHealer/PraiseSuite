import { useEffect, useState, type ReactNode } from "react";
import type { ServiceItem, ServiceItemId, SongSummary } from "@praisesuite/core";
import { serializeOpenSongLyrics } from "@praisesuite/core";
import { api } from "../api.js";

export type AddItemTab = "song" | "scripture" | "custom" | "image" | "style" | "external";

const TABS: [AddItemTab, string][] = [
  ["song", "Songs"],
  ["scripture", "Scripture"],
  ["custom", "Custom"],
  ["image", "Image"],
  ["style", "Style"],
  ["external", "External"],
];

function makeItem(patch: Partial<ServiceItem>): ServiceItem {
  return {
    id: crypto.randomUUID() as ServiceItemId,
    kind: "custom-slides",
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

const input =
  "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const dlgBtn =
  "rounded border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50";

/**
 * OpenSong "add to set" dialogs unified as tabs — Song Lookup
 * (SongPickerWindow: folder select, Quick Lookup, multi-select list, lyric
 * preview, custom/original presentation order), plus scripture, custom
 * slides, image, style, and external items. Emits finished ServiceItems;
 * the caller decides where they land.
 */
export function AddItemDialog({
  tab,
  onTabChange,
  onAdd,
  onClose,
}: {
  tab: AddItemTab;
  onTabChange: (t: AddItemTab) => void;
  onAdd: (items: ServiceItem[]) => void | Promise<void>;
  onClose: () => void;
}): ReactNode {
  const [allSongs, setAllSongs] = useState<SongSummary[]>([]);
  const [songFolder, setSongFolder] = useState("(All)");
  const [songQuery, setSongQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [previewSong, setPreviewSong] = useState<{ text: string; order: string } | null>(null);
  const [customOrder, setCustomOrder] = useState("");
  const [bibles, setBibles] = useState<{ id: string; name: string; abbreviation: string }[]>([]);
  const [bibleId, setBibleId] = useState("");
  const [bibleRef, setBibleRef] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (tab === "song" && allSongs.length === 0) void api.songs().then(setAllSongs).catch(() => {});
    if (tab === "scripture" && bibles.length === 0)
      void api.bibles().then((b) => { setBibles(b); setBibleId((x) => x || b[0]?.id || ""); }).catch(() => {});
  }, [tab, allSongs.length, bibles.length]);

  const orderOf = (song: Awaited<ReturnType<typeof api.song>>) =>
    (song.arrangements[0]?.sequence ?? [])
      .map((as) => {
        const sec = song.sections.find((s) => s.id === as.sectionId);
        return sec ? `${sec.label}${as.prefix ?? ""}` : "";
      })
      .filter(Boolean)
      .join(" ");

  const preview = async (sum: SongSummary) => {
    const song = await api.song(sum.id);
    setPreviewSong({ text: serializeOpenSongLyrics(song), order: orderOf(song) });
  };

  const addSongs = async (ids: string[]) => {
    const items: ServiceItem[] = [];
    for (const id of ids) {
      const sum = allSongs.find((s) => s.id === id);
      if (!sum) continue;
      const song = await api.song(sum.id);
      items.push(
        makeItem({
          kind: "song",
          songId: song.id,
          arrangementId: song.arrangements[0]?.id ?? null,
          title: song.title,
          config: customOrder.trim() ? { presentation: customOrder.trim() } : {},
        }),
      );
    }
    await onAdd(items);
    setPicked(new Set());
    setCustomOrder("");
    setPreviewSong(null);
  };

  const addScripture = async () => {
    if (!bibleId || !bibleRef.trim()) return;
    try {
      const p = await api.passage(bibleId, bibleRef.trim());
      await onAdd([makeItem({ kind: "scripture", title: p.title, slides: p.slides })]);
      setBibleRef("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addCustom = async () => {
    if (!customTitle.trim() && !customBody.trim()) return;
    await onAdd([
      makeItem({
        kind: "custom-slides",
        title: customTitle.trim() || "Custom",
        slides: customBody.split(/\n{2,}/).filter((s) => s.trim()).map((body) => ({ body })),
      }),
    ]);
    setCustomTitle("");
    setCustomBody("");
    onClose();
  };

  const addImage = async (file: File) => {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]!);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const m = await api.uploadMedia(file.name, file.type || "image/png", dataUrl);
    await onAdd([
      makeItem({
        kind: "media",
        title: file.name,
        mediaAssetId: m.storageKey as ServiceItem["mediaAssetId"],
        config: { assetKeys: [m.storageKey] },
      }),
    ]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[520px] w-[640px] flex-col rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tab bar */}
        <div className="mb-3 flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={`rounded-t px-3 py-1.5 text-sm ${
                tab === t ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="mb-1 text-xs text-red-600">{error}</p>}

        {tab === "song" && (
          <>
            <p className="mb-2 text-xs text-zinc-500">
              To add a song, click the song title below and click &quot;Add&quot;. If you know the name of the
              song you can type it in the Quick Lookup field. Double-click a song to add it.
            </p>
            <div className="mb-2 flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                <span className="font-semibold">Select Folder:</span>
                <select value={songFolder} onChange={(e) => setSongFolder(e.target.value)} className={input}>
                  <option>(All)</option>
                  {[...new Set(allSongs.map((s) => s.folder).filter((f): f is string => f !== null))].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 items-center gap-1.5 text-xs">
                <span className="font-semibold">Quick Lookup:</span>
                <input
                  autoFocus
                  value={songQuery}
                  onChange={(e) => setSongQuery(e.target.value)}
                  className={`${input} flex-1`}
                />
              </label>
            </div>
            <div className="flex min-h-0 flex-1 gap-2">
              {/* Song list (multi-select) */}
              <ul className="w-1/2 divide-y divide-zinc-200 overflow-auto rounded border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
                {allSongs
                  .filter(
                    (s) =>
                      (songFolder === "(All)" || s.folder === songFolder) &&
                      (songQuery === "" ||
                        s.title.toLowerCase().includes(songQuery.toLowerCase()) ||
                        s.authors.some((a) => a.toLowerCase().includes(songQuery.toLowerCase()))),
                  )
                  .map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(s.id)) n.delete(s.id);
                            else n.add(s.id);
                            return n;
                          });
                          void preview(s);
                        }}
                        onDoubleClick={() => void addSongs([s.id])}
                        className={`w-full px-2 py-1 text-left text-sm ${
                          picked.has(s.id) ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {s.title}
                      </button>
                    </li>
                  ))}
              </ul>
              {/* Preview + order */}
              <div className="flex w-1/2 flex-col gap-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Song Preview</p>
                <textarea
                  readOnly
                  value={previewSong?.text ?? ""}
                  className="min-h-0 flex-1 resize-none rounded border border-zinc-300 bg-zinc-50 p-1.5 font-mono text-[10px] leading-snug dark:border-zinc-700 dark:bg-zinc-950"
                />
                <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Custom presentation order
                  <input
                    value={customOrder}
                    onChange={(e) => setCustomOrder(e.target.value)}
                    className="mt-0.5 w-full rounded border border-zinc-300 bg-transparent px-2 py-0.5 font-mono text-xs normal-case dark:border-zinc-700"
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Original presentation order
                  <input
                    readOnly
                    value={previewSong?.order ?? ""}
                    className="mt-0.5 w-full rounded border border-zinc-300 bg-zinc-50 px-2 py-0.5 font-mono text-xs normal-case text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void api.songs(songQuery).then(setAllSongs).catch(() => {})}
                className={dlgBtn}
              >
                Search
              </button>
              <div className="flex-1" />
              <button
                disabled={picked.size === 0}
                onClick={() => void addSongs([...picked])}
                className="rounded bg-indigo-600 px-6 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Add
              </button>
              <button onClick={onClose} className={dlgBtn}>Done</button>
            </div>
          </>
        )}

        {tab === "scripture" && (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold">
              Translation
              <select value={bibleId} onChange={(e) => setBibleId(e.target.value)} className={`${input} mt-0.5 w-full font-normal`}>
                {bibles.map((b) => (
                  <option key={b.id} value={b.id}>{b.abbreviation} — {b.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Reference
              <input
                autoFocus
                value={bibleRef}
                onChange={(e) => setBibleRef(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addScripture()}
                placeholder="John 3:16-17"
                className={`${input} mt-0.5 w-full font-normal`}
              />
            </label>
            <button onClick={() => void addScripture()} className="mt-1 self-end rounded bg-indigo-600 px-6 py-1.5 text-sm text-white hover:bg-indigo-500">
              Insert
            </button>
          </div>
        )}

        {tab === "custom" && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <label className="text-xs font-semibold">
              Title
              <input
                autoFocus
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className={`${input} mt-0.5 w-full font-normal`}
              />
            </label>
            <label className="flex min-h-0 flex-1 flex-col text-xs font-semibold">
              Slides (blank line between slides)
              <textarea
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
                className={`${input} mt-0.5 min-h-0 flex-1 resize-none font-mono font-normal`}
              />
            </label>
            <button onClick={() => void addCustom()} className="self-end rounded bg-indigo-600 px-6 py-1.5 text-sm text-white hover:bg-indigo-500">
              Insert
            </button>
          </div>
        )}

        {tab === "image" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-zinc-500">Pick an image to add as a media item.</p>
            <label className={`${dlgBtn} cursor-pointer self-start`}>
              Choose image…
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ""; }}
              />
            </label>
          </div>
        )}

        {tab === "style" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-zinc-500">
              Inserts a style-change marker — items after it use the overridden slide style.
            </p>
            <button
              onClick={() => { void onAdd([makeItem({ kind: "note", title: "Style change", config: { style: {} } })]); onClose(); }}
              className="self-start rounded bg-indigo-600 px-6 py-1.5 text-sm text-white hover:bg-indigo-500"
            >
              Insert
            </button>
          </div>
        )}

        {tab === "external" && (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold">
              File path or URL
              <input
                autoFocus
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && externalUrl.trim()) {
                    void onAdd([makeItem({ kind: "note", title: externalUrl.trim(), config: { external: externalUrl.trim() } })]);
                    onClose();
                  }
                }}
                className={`${input} mt-0.5 w-full font-normal`}
              />
            </label>
            <button
              disabled={!externalUrl.trim()}
              onClick={() => {
                void onAdd([makeItem({ kind: "note", title: externalUrl.trim(), config: { external: externalUrl.trim() } })]);
                onClose();
              }}
              className="self-end rounded bg-indigo-600 px-6 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Insert
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
