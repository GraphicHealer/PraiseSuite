import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api.js";
import { LibraryPage } from "./pages/LibraryPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import { ServicesPage } from "./pages/ServicesPage.js";
import { SongEditorPage } from "./pages/SongEditorPage.js";
import { PresentPage } from "./pages/PresentPage.js";

type Page = "library" | "import" | "services" | "song" | "present";

const NAV: { id: Page; label: string }[] = [
  { id: "library", label: "Library" },
  { id: "services", label: "Services" },
  { id: "import", label: "Import" },
  { id: "present", label: "Present" },
];

function LoginGate({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}` : "Connection failed — is the server running?");
    }
  };
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="mb-1 text-xl font-semibold">PraiseSuite</h1>
      <p className="mb-4 text-sm text-zinc-500">Sign in, or set the admin password on first run.</p>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void attempt(() => api.login(password))}
        placeholder="Password"
        className="mb-3 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void attempt(() => api.login(password))}
          className="flex-1 rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Sign in
        </button>
        <button
          onClick={() => void attempt(() => api.setup(password))}
          className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        >
          First-run setup
        </button>
      </div>
    </div>
  );
}

export function App(): ReactNode {
  const [authed, setAuthed] = useState(api.isAuthed);
  const [page, setPage] = useState<Page>("library");
  const [songId, setSongId] = useState<string | null>(null);
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <LoginGate onDone={() => setAuthed(true)} />
      </div>
    );
  }

  const openSong = (id: string) => {
    setSongId(id);
    setPage("song");
  };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="font-semibold tracking-tight">PraiseSuite</span>
        <nav className="flex gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`rounded px-3 py-1 text-sm ${
                page === n.id
                  ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setDark((d) => !d)} className="rounded px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {dark ? "Light" : "Dark"}
          </button>
          <button
            onClick={() => {
              api.logout();
              setAuthed(false);
            }}
            className="rounded px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1">
        {page === "library" && <LibraryPage onOpenSong={openSong} />}
        {page === "services" && <ServicesPage onOpenSong={openSong} />}
        {page === "import" && <ImportPage />}
        {page === "present" && <PresentPage />}
        {page === "song" && songId && <SongEditorPage id={songId} onBack={() => setPage("library")} />}
      </main>
    </div>
  );
}
