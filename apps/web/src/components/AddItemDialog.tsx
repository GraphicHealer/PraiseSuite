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
  const [bibleDoc, setBibleDoc] = useState<{
    name: string;
    books: { number: number; name: string; chapters: string[][] }[];
  } | null>(null);
  const [bookNum, setBookNum] = useState(0);
  const [chapter, setChapter] = useState(1);
  const [vFrom, setVFrom] = useState(1);
  const [vTo, setVTo] = useState(1);
  const [vPerSlide, setVPerSlide] = useState(2);
  const [showNums, setShowNums] = useState(true);
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

  // ScripturePickerWindow: bible doc loads lazily for the book/chapter/verse lists.
  useEffect(() => {
    if (tab === "scripture" && bibleId && bibleDoc === null)
      void api.bible(bibleId).then(setBibleDoc).catch(() => {});
  }, [tab, bibleId, bibleDoc]);

  const book = bibleDoc?.books.find((b) => b.number === bookNum) ?? null;
  const verses = book?.chapters[chapter - 1] ?? [];
  const to = Math.max(vFrom, Math.min(vTo, verses.length));

  // OpenSong scripture slide text: "v. text v. text" per slide, N verses/slide.
  const scriptureSlides = () => {
    const sel = verses.slice(vFrom - 1, to);
    const slides: { body: string }[] = [];
    for (let i = 0; i < sel.length; i += Math.max(1, vPerSlide)) {
      const group = sel.slice(i, i + Math.max(1, vPerSlide));
      slides.push({
        body: group.map((v, j) => (showNums ? `${vFrom + i + j} ${v}` : v)).join(" "),
      });
    }
    return slides;
  };
  const scrTitle = book ? `${book.name} ${chapter}:${vFrom}${to > vFrom ? `-${to}` : ""}` : "";
  const scrPreview = scriptureSlides().map((s) => s.body).join("\n\n");

  const addScripture = async () => {
    try {
      // Structured pick (book/chapter/verses) or a typed quick reference.
      if (book && verses.length > 0) {
        const slides = scriptureSlides();
        if (slides.length === 0) return;
        const abbr = bibles.find((b) => b.id === bibleId)?.abbreviation ?? null;
        await onAdd([
          makeItem({ kind: "scripture", title: scrTitle, subtitle: abbr, slides }),
        ]);
      } else {
        if (!bibleId || !bibleRef.trim()) return;
        const p = await api.passage(bibleId, bibleRef.trim());
        await onAdd([makeItem({ kind: "scripture", title: p.title, slides: p.slides })]);
      }
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
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                <span className="font-semibold">Version:</span>
                <select
                  value={bibleId}
                  onChange={(e) => { setBibleId(e.target.value); setBibleDoc(null); setBookNum(0); }}
                  className={input}
                >
                  {bibles.map((b) => (
                    <option key={b.id} value={b.id}>{b.abbreviation} — {b.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 items-center gap-1.5 text-xs">
                <span className="font-semibold">Quick reference:</span>
                <input
                  value={bibleRef}
                  onChange={(e) => { setBibleRef(e.target.value); if (e.target.value) setBookNum(0); }}
                  onKeyDown={(e) => e.key === "Enter" && void addScripture()}
                  placeholder="John 3:16-17"
                  className={`${input} flex-1`}
                />
              </label>
            </div>
            <div className="flex min-h-0 flex-1 gap-2">
              {/* OT / NT book lists */}
              {(["OT", "NT"] as const).map((testament) => (
                <div key={testament} className="flex w-1/5 min-w-0 flex-col">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {testament === "OT" ? "Old Testament" : "New Testament"}
                  </p>
                  <ul className="min-h-0 flex-1 overflow-auto rounded border border-zinc-300 dark:border-zinc-700">
                    {(bibleDoc?.books ?? [])
                      .filter((b) => (testament === "OT" ? b.number <= 39 : b.number > 39))
                      .map((b) => (
                        <li key={b.number}>
                          <button
                            onClick={() => { setBookNum(b.number); setChapter(1); setVFrom(1); setVTo(1); setBibleRef(""); }}
                            className={`w-full truncate px-1.5 py-0.5 text-left text-xs ${bookNum === b.number ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                          >
                            {b.name}
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
              {/* Chapter */}
              <div className="flex w-14 shrink-0 flex-col">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Chapter</p>
                <ul className="min-h-0 flex-1 overflow-auto rounded border border-zinc-300 dark:border-zinc-700">
                  {book?.chapters.map((_, i) => (
                    <li key={i}>
                      <button
                        onClick={() => { setChapter(i + 1); setVFrom(1); setVTo(1); }}
                        className={`w-full px-1.5 py-0.5 text-center text-xs ${chapter === i + 1 ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                      >
                        {i + 1}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {/* From / To verse */}
              {(["from", "to"] as const).map((which) => (
                <div key={which} className="flex w-14 shrink-0 flex-col">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {which === "from" ? "Verse" : "Through"}
                  </p>
                  <ul className="min-h-0 flex-1 overflow-auto rounded border border-zinc-300 dark:border-zinc-700">
                    {verses.map((_, i) => (
                      <li key={i}>
                        <button
                          onClick={() => (which === "from" ? setVFrom(i + 1) : setVTo(i + 1))}
                          className={`w-full px-1.5 py-0.5 text-center text-xs ${
                            (which === "from" ? vFrom : Math.max(vFrom, vTo)) === i + 1 ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          }`}
                        >
                          {i + 1}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {/* Preview */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Preview {scrTitle && `— ${scrTitle}`}
                </p>
                <textarea
                  readOnly
                  value={scrPreview}
                  className="min-h-0 flex-1 resize-none rounded border border-zinc-300 bg-zinc-50 p-1.5 text-xs leading-snug dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                <span className="font-semibold">Verses per slide:</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={vPerSlide}
                  onChange={(e) => setVPerSlide(Number(e.target.value) || 1)}
                  className={`${input} w-14`}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={showNums} onChange={(e) => setShowNums(e.target.checked)} />
                Show verse numbers
              </label>
              <div className="flex-1" />
              <button
                disabled={!book && !bibleRef.trim()}
                onClick={() => void addScripture()}
                className="rounded bg-indigo-600 px-6 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Insert
              </button>
              <button onClick={onClose} className={dlgBtn}>Done</button>
            </div>
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
