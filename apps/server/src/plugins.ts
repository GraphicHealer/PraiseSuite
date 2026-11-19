import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginContext, PluginManifest, PluginModule } from "@praisesuite/core";
import { ApiError } from "./http.js";

/** Plugin ids must be safe directory names — also guards path traversal. */
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Scan `<pluginsDir>/<id>/plugin.json` for every subdirectory. Malformed
 * manifests are skipped — one bad plugin must not break the host.
 */
export async function scanPlugins(pluginsDir: string): Promise<PluginManifest[]> {
  let entries;
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: PluginManifest[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    try {
      const m = JSON.parse(
        await readFile(join(pluginsDir, e.name, "plugin.json"), "utf8"),
      ) as PluginManifest;
      if (typeof m.id === "string" && ID_RE.test(m.id) && typeof m.name === "string") {
        out.push(m);
      }
    } catch {
      /* missing/invalid plugin.json — skip */
    }
  }
  return out;
}

const moduleCache = new Map<string, PluginModule | null>();
/** activate() runs once per plugin module. */
const activated = new Set<string>();

/**
 * Route a command to a plugin's server-side module. Plugins without a `main`
 * are manifest-only (menu contributions handled client-side) and get 501.
 */
export async function invokePluginCommand(
  pluginsDir: string,
  pluginId: string,
  command: string,
  payload: unknown,
  ctx: PluginContext,
): Promise<unknown> {
  if (!ID_RE.test(pluginId) || !ID_RE.test(command)) {
    throw new ApiError(400, "invalid_input", "Invalid plugin or command id");
  }
  const manifest = (await scanPlugins(pluginsDir)).find((m) => m.id === pluginId);
  if (!manifest) throw new ApiError(404, "not_found", "Plugin not found");
  if (typeof manifest.main !== "string" || manifest.main === "") {
    throw new ApiError(501, "not_implemented", "Plugin has no server module");
  }
  let mod = moduleCache.get(pluginId);
  if (mod === undefined) {
    try {
      mod = (await import(
        pathToFileURL(join(pluginsDir, pluginId, manifest.main)).href
      )) as PluginModule;
    } catch {
      mod = null;
    }
    moduleCache.set(pluginId, mod);
  }
  if (mod === null) {
    throw new ApiError(500, "plugin_error", "Plugin module failed to load");
  }
  if (!activated.has(pluginId)) {
    activated.add(pluginId);
    await mod.activate?.(ctx);
  }
  if (typeof mod.executeCommand !== "function") {
    throw new ApiError(501, "not_implemented", "Plugin does not handle commands");
  }
  return mod.executeCommand(command, payload, ctx);
}
