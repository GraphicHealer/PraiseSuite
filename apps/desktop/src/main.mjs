import { app, BrowserWindow, screen, ipcMain, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(dir, "..", "..", "..");
const PORT = Number(process.env.PRAISESUITE_PORT ?? 7729);
const BASE = `http://127.0.0.1:${PORT}`;

let serverProc = null;
let outputWindow = null;
let controlWindow = null;

/**
 * Child-process server (TAS 3.5): the same apps/server that serves REST+WS
 * is spawned under Electron's Node runtime (ELECTRON_RUN_AS_NODE), so a
 * renderer crash can never take the data layer down with it.
 */
function startServer() {
  const serverDir = path.join(ROOT, "apps", "server");
  // Prefer a system Node for dev — better-sqlite3's native module is built
  // against Node's ABI there. Packaged builds can force Electron's runtime
  // (ELECTRON_RUN_AS_NODE) with an electron-rebuilt module.
  const tsxCli = path.join(serverDir, "node_modules", "tsx", "dist", "cli.mjs");
  const runtime = process.env.PRAISESUITE_SERVER_RUNTIME ?? "node";
  const cmd = runtime === "electron" ? process.execPath : runtime;
  const env = {
    ...process.env,
    PORT: String(PORT),
    PRAISESUITE_DATA: path.join(app.getPath("userData"), "data"),
    PRAISESUITE_WEB_ROOT: path.join(ROOT, "apps", "web", "dist"),
    // Desktop is single-user: only one live presentation session at a time.
    PRAISESUITE_SINGLE_SESSION: "1",
  };
  if (runtime === "electron") env.ELECTRON_RUN_AS_NODE = "1";
  serverProc = spawn(cmd, [tsxCli, "src/index.ts"], {
    cwd: serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    console.error(`server exited (${code})`);
    serverProc = null;
  });
}

/** Wait until the API responds before opening windows. */
async function waitForServer(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("PraiseSuite server did not start");
}

function openControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(dir, "preload.mjs") },
  });
  controlWindow.loadURL(`${BASE}/`);
  controlWindow.on("closed", () => (controlWindow = null));
}

/**
 * Native printing: render a print URL offscreen, then either show the OS
 * print dialog (webContents.print) or emit a PDF directly (printToPDF).
 * The renderer reaches these through window.ps (see preload.mjs).
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
    webPreferences: { contextIsolation: true, preload: path.join(dir, "preload.mjs") },
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
    const res = await fetch(`${BASE}/api/v1/settings/present.displayMode`);
    if (res.ok) displayMode = ((await res.json()).value ?? "auto") || "auto";
  } catch {
    displayMode = "auto";
  }
}

function openOutputWindow() {
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
    // Dual-screen test: dock the helper on the left half and a 16:9 output
    // window vertically centered on the right half — two side-by-side
    // "screens" on one monitor.
    const wa = primary.workArea;
    const half = Math.floor(wa.width / 2);
    const w = half;
    const h = Math.floor((w * 9) / 16);
    if (controlWindow !== null && !controlWindow.isDestroyed()) {
      controlWindow.unmaximize();
      controlWindow.setBounds({ x: wa.x, y: wa.y, width: half, height: wa.height });
    }
    outputWindow = new BrowserWindow({
      x: wa.x + half,
      y: wa.y + Math.floor((wa.height - h) / 2),
      width: w,
      height: h,
      title: "Presentation Output (Test)",
      autoHideMenuBar: true,
      backgroundColor: "#000000",
      webPreferences: {
        contextIsolation: true,
        preload: path.join(dir, "preload.mjs"),
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
        preload: path.join(dir, "preload.mjs"),
      },
    });
  }
  outputWindow.loadURL(`${BASE}/receiver`);
  outputWindow.on("closed", () => (outputWindow = null));
}

// [M] Full Screen / Normal Screen on the operator console.
ipcMain.handle("ps:toggle-output", () => {
  if (outputWindow === null) {
    displayMode = "single";
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
    outputWindow.close();
    outputWindow = null;
  }
  openOutputWindow();
  return displayMode;
});

// True when the calling webContents is the presentation output window —
// lets /receiver drive the session with the OpenSong keymap locally.
ipcMain.handle("ps:is-output", (e) => outputWindow !== null && e.sender === outputWindow.webContents);

// Display count so Settings can disable Dual Screen on single-monitor rigs.
ipcMain.handle("ps:display-count", () => screen.getAllDisplays().length);

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (e) {
    console.error(e.message);
  }
  openControlWindow();
  await loadDisplayMode();
  openOutputWindow();

  screen.on("display-added", () => {
    if (outputWindow === null) openOutputWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  serverProc?.kill();
});
