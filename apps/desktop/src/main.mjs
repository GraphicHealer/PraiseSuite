import { app, BrowserWindow, screen, ipcMain, dialog } from "electron";
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

ipcMain.handle("ps:print", async (_e, url) => {
  const win = await hiddenPrintWindow(url);
  await new Promise((resolve, reject) =>
    win.webContents.print({ printBackground: true }, (ok, reason) => {
      win.destroy();
      if (ok) resolve();
      else reject(new Error(reason));
    }),
  );
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
 * Presentation output: fullscreen borderless window on the first
 * non-primary display (projector), falling back to a normal window when
 * there's only one display.
 */
function openOutputWindow() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = displays.find((d) => d.id !== primary.id);

  // Single display: skip the output window — the presenter can open
  // /receiver in a tab or plug in a projector to auto-attach.
  if (!target) {
    console.log("single display — no output window (plug in a projector for fullscreen output)");
    return;
  }

  outputWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    fullscreen: true,
    frame: false,
    alwaysOnTop: false,
    backgroundColor: "#000000",
    webPreferences: { contextIsolation: true },
  });
  outputWindow.loadURL(`${BASE}/receiver`);
  outputWindow.on("closed", () => (outputWindow = null));
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (e) {
    console.error(e.message);
  }
  openControlWindow();
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
