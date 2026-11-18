import { useEffect, useState, type ReactNode } from "react";
import type { Service } from "@praisesuite/core";
import { api, ApiError } from "./api.js";
import { MainPage } from "./pages/MainPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import { PresentPage } from "./pages/PresentPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { PrintWindow } from "./PrintPreview.js";

type Page = "main" | "import" | "present" | "settings";

const NAV: { id: Page; label: string }[] = [
  { id: "import", label: "Import" },
  { id: "present", label: "Present" },
  { id: "settings", label: "Settings" },
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
  const [authRequired, setAuthRequired] = useState(true);
  const [page, setPage] = useState<Page>("main");
  // Popup print window: opened via openPrintPreview (?print=<url>) — standalone UI, no nav chrome.
  const [printParams] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("print") !== null ? p : null;
  });
  const [presentReq, setPresentReq] = useState<{ service: Service; itemId: string | undefined } | null>(null);
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Local mode (LAN off) needs no login — the server trusts localhost.
  useEffect(() => {
    fetch("/api/v1/health")
      .then((r) => r.json())
      .then((h: { authRequired?: boolean }) => {
        setAuthRequired(h.authRequired !== false);
        if (h.authRequired === false) setAuthed(true);
      })
      .catch(() => {});
  }, []);

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

  if (printParams !== null) {
    return <PrintWindow params={printParams} />;
  }

  const present = (service: Service, itemId?: string) => {
    setPresentReq({ service, itemId });
    setPage("present");
  };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setPage("main")}
          className={`font-semibold tracking-tight ${page === "main" ? "text-indigo-700 dark:text-indigo-300" : ""}`}
        >
          PraiseSuite
        </button>
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
          {authRequired && (
            <button
              onClick={() => {
                api.logout();
                setAuthed(false);
              }}
              className="rounded px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="flex-1">
        {page === "main" && <MainPage onPresentService={present} onImport={() => setPage("import")} />}
        {page === "import" && <ImportPage />}
        {page === "present" && (
          <PresentPage
            key={presentReq ? `${presentReq.service.id}:${presentReq.itemId ?? ""}` : "pick"}
            startService={presentReq?.service ?? null}
            startItemId={presentReq?.itemId ?? null}
          />
        )}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
