/**
 * Plugin framework — manifest + contribution types.
 *
 * A plugin is a directory under `<dataDir>/plugins/<id>/` containing a
 * `plugin.json` manifest. Plugins can contribute items to named menus
 * (e.g. the presentation-mode menu) and may ship an optional server-side
 * ESM `main` module that executes commands — the seam a future OBS/NDI/
 * casting plugin uses to provide its own presentation output instead of a
 * second screen.
 */

/** A single contributed menu entry. */
export interface PluginMenuItem {
  /** Stable id, unique within the menu. */
  id: string;
  label: string;
  description?: string;
  /**
   * For the `present.mode` menu: the display-mode value applied when picked.
   * Plugin modes are conventionally `plugin:<pluginId>:<mode>` and mean "the
   * plugin supplies the output" — no local output window is created.
   */
  mode?: string;
  /** Optional command routed to the plugin's server-side executeCommand. */
  command?: string;
  /** Menu placement hint; lower sorts first. */
  order?: number;
}

export interface PluginManifest {
  /** Stable plugin id — must match its directory name. */
  id: string;
  name: string;
  version?: string;
  description?: string;
  /**
   * Optional server-side ESM entry, relative to the plugin directory
   * (e.g. "main.mjs"). Loaded lazily on first command invocation.
   */
  main?: string;
  contributes?: {
    /** menu id -> contributed items, e.g. { "present.mode": [...] }. */
    menus?: Record<string, PluginMenuItem[]>;
  };
}

/** Services handed to a plugin's server-side module. */
export interface PluginContext {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  broadcastToSession(sessionId: string, message: unknown): void;
  /** Base URL of this server instance, e.g. http://127.0.0.1:7729 */
  serverBaseUrl: string;
}

/** Shape of a plugin's server-side `main` module. */
export interface PluginModule {
  activate?(ctx: PluginContext): void | Promise<void>;
  executeCommand?(
    command: string,
    payload: unknown,
    ctx: PluginContext,
  ): unknown | Promise<unknown>;
}
