import { app, BrowserWindow, screen, ipcMain, dialog, shell, session } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(dir, "..", "..", "..");
/** External (LAN) port — receivers/stage/remotes. Only bound while LAN access is enabled. */
const PORT = Number(process.env.PRAISESUITE_PORT ?? 7729);
/** Per-launch token gating the internal loopback listener (Electron windows only). */
const INTERNAL_TOKEN = randomUUID();
/** Resolved once the server reports its internal port on stdout. */
let BASE = null;
let resolveBase;
const baseReady = new Promise((r) => (resolveBase = r));

let serverProc = null;
let outputWindow = null;
let controlWindow = null;
let presenterWindow = null;
/** Lets programmatic closes bypass the presentation windows' exit confirm. */
let closeConfirmed = false;
let appQuitting = false;
app.on("before-quit", () => (appQuitting = true));

/**
 * Closing a presentation window (helper or output canvas) ends the whole
 * presentation — confirm first. `action` runs on "Exit". `getParent` picks
 * the window the dialog attaches to — the operator's helper, not the
 * projection canvas.
 */
function confirmExitPresentation(getParent, action) {
  return (e) => {
    if (closeConfirmed || appQuitting) return;
    e.preventDefault();
    void dialog
      .showMessageBox(getParent(), {
        type: "question",
        title: "PraiseSuite",
        message: "Exit the presentation?",
        buttons: ["Exit", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          closeConfirmed = true;
          action();
          closeConfirmed = false;
        }
      });
  };
}

/** Fetch carrying the internal token — main-process calls have no cookies. */
const localFetch = (url, init) =>
  fetch(url, { ...init, headers: { authorization: `Bearer ${INTERNAL_TOKEN}` } });

/**
 * Child-process server (TAS 3.5): the same apps/server that serves REST+WS
 * runs as its own process, so a renderer crash can never take the data
 * layer down with it. Packaged builds spawn the bundled Node runtime
 * (resources/runtime/node.exe — its ABI matches the shipped better-sqlite3
 * prebuild); dev spawns system `node` with tsx on the TypeScript sources.
 */
function startServer(dataDir) {
  const env = {
    ...process.env,
    PORT: String(PORT),
    PRAISESUITE_DATA: dataDir,
    // Desktop is single-user: only one live presentation session at a time.
    PRAISESUITE_SINGLE_SESSION: "1",
    // Split-listener mode: internal loopback listener on an ephemeral port,
    // gated by a per-launch token — PORT is the external (LAN) listener.
    PRAISESUITE_INTERNAL: "1",
    PRAISESUITE_INTERNAL_TOKEN: INTERNAL_TOKEN,
  };
  // If a user's shell sets ELECTRON_RUN_AS_NODE globally, it would make the
  // bundled runtime act like Electron-node on exes — strip it (the bundled
  // runtime is real node.exe anyway).
  delete env.ELECTRON_RUN_AS_NODE;
  let cmd, args, cwd;
  if (app.isPackaged) {
    const res = process.resourcesPath;
    cmd = path.join(res, "runtime", "node.exe");
    args = ["server.mjs"];
    // node_modules can't sit at the extraResources root (electron-builder
    // filters it) — the server lives one level down in server/app/.
    cwd = path.join(res, "server", "app");
    env.PRAISESUITE_WEB_ROOT = path.join(res, "web");
    env.PRAISESUITE_ASSETS = path.join(res, "assets", "opensong-defaults");
  } else {
    cmd = process.env.PRAISESUITE_SERVER_RUNTIME ?? "node";
    args = [path.join("node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"];
    cwd = path.join(ROOT, "apps", "server");
    env.PRAISESUITE_WEB_ROOT = path.join(ROOT, "apps", "web", "dist");
    if (cmd === "electron") {
      cmd = process.execPath;
      env.ELECTRON_RUN_AS_NODE = "1";
    }
  }
  serverProc = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  serverProc.stdout.on("data", (d) => {
    process.stdout.write(`[server] ${d}`);
    const m = /Internal listener: http:\/\/127\.0\.0\.1:(\d+)/.exec(d.toString());
    if (m && BASE === null) {
      BASE = `http://127.0.0.1:${m[1]}`;
      resolveBase();
    }
  });
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    console.error(`server exited (${code})`);
    serverProc = null;
  });
}

/**
 * Portable builds (electron-builder sets PORTABLE_EXECUTABLE_DIR to the
 * exe's folder) keep their data where the user chooses — the pick is
 * remembered in `praisesuite-data-path.txt` next to the exe. Paths inside
 * the exe's folder are stored RELATIVE so a USB stick's changing drive
 * letter doesn't break the link.
 */
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR;
const PORTABLE_MARKER = PORTABLE_DIR
  ? path.join(PORTABLE_DIR, "praisesuite-data-path.txt")
  : null;

/** Resolve a marker-stored path: relative means relative to the exe dir. */
function portablePath(stored) {
  return path.isAbsolute(stored) ? stored : path.resolve(PORTABLE_DIR, stored);
}

/** Record the chosen dir in the marker — relative when under the exe dir. */
async function writePortableMarker(dir) {
  const rel = path.relative(PORTABLE_DIR, dir);
  const stored = rel.startsWith("..") || path.isAbsolute(rel) ? dir : `.${path.sep}${rel}`;
  await writeFile(PORTABLE_MARKER, stored, "utf8");
}

/** First-run / missing-dir prompt: default next to the exe, or a folder pick. */
async function pickPortableDataDir() {
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "PraiseSuite",
    message: "Where should PraiseSuite store its data?",
    detail:
      "Songs, sets, media, and settings live in this folder. Keeping it next " +
      "to the app makes the whole setup portable.",
    buttons: ["Next to the app", "Choose a folder…", "Quit"],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 2) return null;
  if (response === 0) return path.join(PORTABLE_DIR, "PraiseSuite Data");
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose a data folder",
    defaultPath: PORTABLE_DIR,
    properties: ["openDirectory", "createDirectory", "promptToCreate"],
  });
  return canceled || filePaths.length === 0 ? pickPortableDataDir() : filePaths[0];
}

async function resolveDataDir() {
  if (PORTABLE_MARKER === null) return path.join(app.getPath("userData"), "data");
  try {
    const stored = (await readFile(PORTABLE_MARKER, "utf8")).trim();
    const dir = portablePath(stored);
    // A vanished folder means the user moved/renamed it — re-ask rather than
    // silently starting with an empty library.
    if (existsSync(dir)) return dir;
  } catch {
    /* no marker yet — first run */
  }
  const dir = await pickPortableDataDir();
  if (dir === null) return null;
  await writePortableMarker(dir).catch(() => {}); // read-only exe dir → ask every run
  return dir;
}

/** Wait until the API responds before opening windows. */
async function waitForServer(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await Promise.race([baseReady, new Promise((r) => setTimeout(r, 250))]);
    if (BASE !== null) {
      try {
        const res = await localFetch(`${BASE}/api/v1/health`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
    }
  }
  throw new Error("PraiseSuite server did not start");
}

function openControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(dir, "preload.cjs") },
  });
  controlWindow.loadURL(`${BASE}/`);
  controlWindow.on("closed", () => (controlWindow = null));
}

/**
 * Native printing: render a print URL offscreen, then either show the OS
 * print dialog (webContents.print) or emit a PDF directly (printToPDF).
 * The renderer reaches these through window.ps (see preload.cjs).
 */
async function hiddenPrintWindow(url) {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL(url);
  return win;
}

/**
 * "Print…": Windows' system print dialog shows "this app doesn't support
 * print preview" for Electron — it can't be fed a preview stream. So we
 * render to PDF and open it in the default PDF viewer, which has a real
 * preview and its own print dialog.
 */
ipcMain.handle("ps:print", async (_e, url) => {
  const win = await hiddenPrintWindow(url);
  const pdf = await win.webContents.printToPDF({ printBackground: true });
  win.destroy();
  const tmp = path.join(app.getPath("temp"), `praisesuite-print-${Date.now()}.pdf`);
  await writeFile(tmp, pdf);
  await shell.openPath(tmp);
});

/**
 * Print preview: a real popup window (Chrome-print-preview style) holding the
 * app at /?print=<url> — its own options panel + paged.js page sheets.
 */
ipcMain.handle("ps:open-print", async (_e, query) => {
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    title: "Print preview — PraiseSuite",
    webPreferences: { contextIsolation: true, preload: path.join(dir, "preload.cjs") },
  });
  win.setMenu(null); // popup = document window, not an app window — no File/Edit/View bar
  await win.loadURL(`${BASE}/?${query}`);
});

ipcMain.handle("ps:print-pdf", async (e, { url, filename }) => {
  const win = await hiddenPrintWindow(url);
  const pdf = await win.webContents.printToPDF({ printBackground: true });
  win.destroy();
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    title: "Save as PDF",
    defaultPath: filename ?? "document.pdf",
    filters: [{ name: "PDF document", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return null;
  await writeFile(filePath, pdf);
  return filePath;
});

/**
 * Presentation output modes (OpenSong monitor_mode):
 *   auto    — dual when a second display exists, else preview.
 *   dual    — fullscreen output on the first non-primary display;
 *             falls back to preview when only one display is present.
 *   single  — fullscreen output window on the primary display; controlled
 *             by the OpenSong keymap (handled by the receiver page itself).
 *   preview — dual-screen test: a windowed output on the primary display's
 *             right half, standing in for a second monitor.
 *   network — no local output window; remote devices open /receiver over LAN.
 */
let displayMode = "auto";

async function loadDisplayMode() {
  try {
    const res = await localFetch(`${BASE}/api/v1/settings/present.displayMode`);
    if (res.ok) displayMode = ((await res.json()).value ?? "auto") || "auto";
  } catch {
    displayMode = "auto";
  }
}

function openOutputWindow(url) {
  if (outputWindow !== null) return;
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = displays.find((d) => d.id !== primary.id);
  const mode = displayMode === "auto" ? (target ? "dual" : "preview") : displayMode;

  // single/dual/preview create a local output window; network and
  // plugin-provided modes (e.g. a future "plugin:obs:*" output) do not.
  if (mode === "network" || mode.startsWith("plugin:")) {
    console.log(`${mode} mode — no local output window`);
    return;
  }
  if (mode === "dual" && !target) {
    console.log("dual mode requested but no second display — no output window");
    return;
  }

  // dual → fullscreen on the second display; single → fullscreen on primary;
  // preview (dual-screen test) → a windowed "screen" on the primary's right
  // half, framed so it can be moved/resized like a real second monitor.
  if (mode === "preview") {
    // OpenSong MODE_PREVIEW (PresentWindow.xojo_window): the 16:9 output
    // sits in the upper-left; the helper keeps its natural 800x600 size at
    // the bottom-right — they don't split the screen.
    const wa = primary.workArea;
    const aspect = primary.size.width / primary.size.height;
    const helperW = 800, helperH = 600;
    let w = wa.width - helperW - 30;
    let h = Math.floor(w / aspect);
    if (h > wa.height) {
      h = wa.height;
      w = Math.floor(h * aspect);
    }
    if (presenterWindow !== null && !presenterWindow.isDestroyed()) {
      presenterWindow.unmaximize();
      presenterWindow.setBounds({
        x: wa.x + wa.width - helperW - 10,
        y: wa.y + primary.size.height - helperH - 40,
        width: helperW,
        height: helperH,
      });
    }
    outputWindow = new BrowserWindow({
      x: wa.x + 10,
      y: wa.y + 10,
      width: w,
      height: h,
      title: "Presentation Output (Test)",
      autoHideMenuBar: true,
      backgroundColor: "#000000",
      webPreferences: {
        contextIsolation: true,
        preload: path.join(dir, "preload.cjs"),
      },
    });
  } else {
    const bounds = mode === "dual" && target ? target.bounds : primary.bounds;
    outputWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      fullscreen: true,
      frame: false,
      backgroundColor: "#000000",
      webPreferences: {
        contextIsolation: true,
        preload: path.join(dir, "preload.cjs"),
      },
    });
  }
  outputWindow.loadURL(url ?? `${BASE}/receiver`);
  // The canvas has no X in fullscreen dual/single modes — this mainly covers
  // the framed preview window. Prompt shows on the helper, not the canvas.
  outputWindow.on(
    "close",
    confirmExitPresentation(() => presenterWindow ?? outputWindow, endPresentation),
  );
  outputWindow.on("closed", () => {
    outputWindow = null;
    // Single-screen mode: the output window IS the presentation (OpenSong
    // opens no helper on one monitor). Closing it ends the presentation.
    if (displayMode === "single" && presenterWindow === null) endPresentation();
  });
}

// [M] Full Screen / Normal Screen on the operator console.
ipcMain.handle("ps:toggle-output", () => {
  if (outputWindow === null) {
    // Only create an output while a presentation is running ([M] adds a screen).
    if (presenterWindow === null) return "windowed";
    openOutputWindow();
    return "windowed";
  }
  const fs = outputWindow.isFullScreen();
  outputWindow.setFullScreen(!fs);
  return fs ? "windowed" : "fullscreen";
});

/**
 * Switch the presentation output mode at runtime (Present-menu modes and
 * plugin-provided output modes). Unknown/plugin modes => no local window;
 * the plugin supplies its own output (OBS input, NDI, cast, ...).
 */
ipcMain.handle("ps:set-display-mode", (_e, mode) => {
  displayMode = typeof mode === "string" && mode !== "" ? mode : "auto";
  if (outputWindow !== null) {
    closeConfirmed = true;
    outputWindow.close();
    closeConfirmed = false;
    outputWindow = null;
  }
  // Output windows exist only while a presentation is running.
  if (presenterWindow !== null) openOutputWindow();
  return displayMode;
});

/**
 * Start a presentation (OpenSong: Status_Presentation + minimized main
 * window). Opens a dedicated presenter window — or, in single mode, only
 * the fullscreen output which drives the session itself — then closes the
 * control window. Output windows exist only while a presentation runs.
 */
ipcMain.handle("ps:present", (_e, mode, serviceId, itemId) => {
  displayMode = typeof mode === "string" && mode !== "" ? mode : displayMode;
  const q =
    `?present=1` +
    (serviceId ? `&service=${encodeURIComponent(serviceId)}` : "") +
    (itemId ? `&item=${encodeURIComponent(itemId)}` : "");
  if (displayMode === "single") {
    openOutputWindow(`${BASE}/receiver${q}`);
  } else {
    presenterWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, preload: path.join(dir, "preload.cjs") },
    });
    presenterWindow.loadURL(`${BASE}/${q}`);
    presenterWindow.on(
      "close",
      confirmExitPresentation(() => presenterWindow, () => presenterWindow?.close()),
    );
    presenterWindow.on("closed", () => {
      presenterWindow = null;
      endPresentation();
    });
    // Open the output only once the presenter reports a live session —
    // otherwise /receiver sits on "waiting for a live session…" for the
    // few seconds it takes the helper window to boot and create one.
    // Fallback still opens it if the signal never arrives.
    ipcMain.once("ps:session-live", () => openOutputWindow());
    setTimeout(() => openOutputWindow(), 8_000);
  }
  if (controlWindow !== null) controlWindow.close();
  return displayMode;
});

/** End the presentation: close presentation windows, restore the control window. */
function endPresentation() {
  // Explicit exit paths (Return/esc, mode switches) don't re-ask.
  closeConfirmed = true;
  if (outputWindow !== null) outputWindow.close();
  if (presenterWindow !== null) presenterWindow.close();
  closeConfirmed = false;
  void endLiveSessions();
  if (controlWindow === null) openControlWindow();
}

/**
 * Ending the presentation terminates its session — otherwise a "live"
 * session outlives its windows and /receiver/join can serve a stale one
 * (output window frozen on an old slide).
 */
async function endLiveSessions() {
  try {
    const res = await localFetch(`${BASE}/api/v1/sessions`);
    if (!res.ok) return;
    for (const s of await res.json()) {
      await localFetch(`${BASE}/api/v1/sessions/${s.id}/end`, { method: "POST" });
    }
  } catch {
    /* server not up yet */
  }
}
ipcMain.handle("ps:present-exit", () => endPresentation());

// True when the calling webContents is the presentation output window —
// lets /receiver drive the session with the OpenSong keymap locally.
ipcMain.handle("ps:is-output", (e) => outputWindow !== null && e.sender === outputWindow.webContents);

// Display count so Settings can disable Dual Screen on single-monitor rigs.
ipcMain.handle("ps:display-count", () => screen.getAllDisplays().length);

app.whenReady().then(async () => {
  const dataDir = await resolveDataDir();
  if (dataDir === null) {
    app.exit(0);
    return;
  }
  if (PORTABLE_DIR) {
    // Keep Chromium's caches/userData inside the chosen folder too — a
    // portable app shouldn't leave traces in %APPDATA%.
    app.setPath("userData", path.join(dataDir, ".electron"));
  }
  startServer(dataDir);
  try {
    await waitForServer();
  } catch (e) {
    console.error(e.message);
  }
  // Every Electron window shares defaultSession — one cookie gives the
  // internal listener's token gate to control/presenter/output/print
  // windows transparently (fetch, <img>, WebSocket all carry cookies).
  if (BASE !== null) {
    await session.defaultSession.cookies
      .set({ url: BASE, name: "ps_internal", value: INTERNAL_TOKEN })
      .catch((e) => console.error(`internal cookie failed: ${e.message}`));
  }
  openControlWindow();
  await loadDisplayMode();
  // No output window at startup — it opens with the presentation.

  screen.on("display-added", () => {
    if (outputWindow === null && presenterWindow !== null) openOutputWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  serverProc?.kill();
});
