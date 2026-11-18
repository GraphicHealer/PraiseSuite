/**
 * Font-resolution map (font strategy): legacy/platform-specific names from
 * imported content are mapped to bundled open-license families with
 * cross-platform metrics. OpenSong's original font files are never used.
 *
 * Bundled (via @fontsource in the web/desktop builds):
 *   Inter          — sans/UI/lyrics (replaces System, Helvetica, Arial…)
 *   Source Serif 4 — serif titles/print (replaces Times New Roman, Georgia…)
 *   JetBrains Mono — mono/chords (replaces Courier New, Consolas, Monaco…)
 */
const FONT_MAP: Record<string, string> = {
  system: "Inter",
  smallsystem: "Inter",
  helvetica: "Inter",
  "helvetica neue": "Inter",
  arial: "Inter",
  "arial narrow": "Inter",
  verdana: "Inter",
  tahoma: "Inter",
  geneva: "Inter",
  "segoe ui": "Inter",
  sansserif: "Inter",
  "sans-serif": "Inter",
  "times new roman": "Source Serif 4",
  times: "Source Serif 4",
  georgia: "Source Serif 4",
  serif: "Source Serif 4",
  "courier new": "JetBrains Mono",
  courier: "JetBrains Mono",
  consolas: "JetBrains Mono",
  monaco: "JetBrains Mono",
  "lucida console": "JetBrains Mono",
  monospace: "JetBrains Mono",
};

/** Bundled families — the extensible registry for future user-configured fonts. */
export const BUNDLED_FONTS = ["Inter", "Source Serif 4", "JetBrains Mono"] as const;

/**
 * Resolve a font name to a bundled family. Unknown names pass through
 * (they may be legitimately installed user fonts); only legacy/platform
 * names are remapped.
 */
export function resolveFont(name: string): string {
  return FONT_MAP[name.trim().toLowerCase()] ?? name;
}

/** CSS font-family value with sensible fallbacks. */
export function fontStack(name: string): string {
  const family = resolveFont(name);
  const fallback = family === "JetBrains Mono" ? "monospace" : family === "Source Serif 4" ? "serif" : "sans-serif";
  return `"${family}", ${fallback}`;
}
