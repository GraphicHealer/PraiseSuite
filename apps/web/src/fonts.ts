/**
 * Font-resolution mirror of packages/core fonts.ts — legacy/platform names
 * map to bundled @fontsource families; unknown names pass through.
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

export function resolveFont(name: string): string {
  return FONT_MAP[name.trim().toLowerCase()] ?? name;
}

export function fontStack(name: string): string {
  const family = resolveFont(name);
  const fallback = family === "JetBrains Mono" ? "monospace" : family === "Source Serif 4" ? "serif" : "sans-serif";
  return `"${family}", ${fallback}`;
}

export const BUNDLED_FONTS = ["Inter", "Source Serif 4", "JetBrains Mono"] as const;
