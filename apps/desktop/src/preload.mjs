import { contextBridge, ipcRenderer } from "electron";

// Print bridge: webContents.print / printToPDF via a hidden print window in
// the main process. `window.ps` is undefined in plain browsers — the web app
// falls back to iframe.print() there.
contextBridge.exposeInMainWorld("ps", {
  /** Native OS print dialog for a same-origin print URL. */
  print: (url) => ipcRenderer.invoke("ps:print", url),
  /** Save-to-PDF dialog; resolves the saved path or null when cancelled. */
  printToPdf: (url, filename) => ipcRenderer.invoke("ps:print-pdf", { url, filename }),
  /** Open the print-preview window (a real BrowserWindow, not an overlay). */
  openPrintWindow: (query) => ipcRenderer.invoke("ps:open-print", query),
  /** Toggle the presentation output window fullscreen/windowed. */
  toggleOutput: () => ipcRenderer.invoke("ps:toggle-output"),
  /** True when this webContents IS the presentation output window. */
  isOutput: () => ipcRenderer.invoke("ps:is-output"),
  /** Number of connected displays. */
  displayCount: () => ipcRenderer.invoke("ps:display-count"),
});
