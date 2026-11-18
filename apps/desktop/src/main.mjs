import { app, BrowserWindow, screen, ipcMain, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(dir, "..", "..", "..");
const PORT = Number(process.env.PRAISESUITE_PORT ?? 8080);
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
 * Presentation output modes (OpenSong Present → single/dual/preview):
 *   auto    — dual_screen when a second display exists, else preview.
 *   dual    — fullscreen borderless on the first non-primary display;
 *             a resizable window on the primary when there is only one.
 *   single  — a resizable receiver window on the primary display.
 *   preview — no output window; the helper's previews are the output.
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

  if (mode === "preview") {
    console.log("preview mode — helper window previews are the output");
    return;
  }

  if (mode === "dual" && target) {
    outputWindow = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      fullscreen: true,
      frame: false,
      backgroundColor: "#000000",
      webPreferences: { contextIsolation: true },
    });
  } else {
    // single (or dual with only one display): resizable window on primary.
    outputWindow = new BrowserWindow({
      width: 960,
      height: 540,
      backgroundColor: "#000000",
      webPreferences: { contextIsolation: true },
    });
    outputWindow.setMenuBarVisibility(false);
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
