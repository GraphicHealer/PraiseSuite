import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SongSummary } from "@praisesuite/core";
import { api } from "../api.js";

export function LibraryPage({ onOpenSong }: { onOpenSong: (id: string) => void }): ReactNode {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .songs(query || undefined)
        .then((s) => {
          setSongs(s);
          setError("");
        })
        .catch((e) => setError((e as Error).message));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const themes = useMemo(
    () =>
      [...new Set(songs.map((s) => s.theme).filter((t): t is string => t !== null))].sort(),
    [songs],
  );
  const filtered = theme ? songs.filter((s) => s.theme === theme) : songs;

  return (
    <div className="mx-auto flex max-w-6xl gap-6 p-4">
      <aside className="w-48 shrink-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Themes</h2>
        <button
          onClick={() => setTheme(null)}
          className={`block w-full rounded px-2 py-1 text-left text-sm ${theme === null ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          All ({songs.length})
        </button>
        {themes.map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className={`block w-full rounded px-2 py-1 text-left text-sm ${theme === t ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            {t}
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, authors, lyrics..."
          className="mb-3 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onOpenSong(s.id)}
                className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="font-medium">{s.title}</span>
                <span className="truncate text-sm text-zinc-500">{s.authors.join(", ")}</span>
                {s.theme && <span className="ml-auto shrink-0 text-xs text-zinc-400">{s.theme}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-zinc-500">
              No songs — try the Import tab to bring in an OpenSong library.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
