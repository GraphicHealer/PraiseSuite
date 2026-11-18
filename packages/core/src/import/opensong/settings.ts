import { resolveFont } from "../../application/fonts.js";
import {
  defaultSlideStyle,
  type SlideStyle,
  type TextStyle,
} from "../../domain/styles/types.js";
import { asRecord, asString, parseXml } from "./xml.js";

export interface PresentSettingsResult {
  style: SlideStyle;
  /** Base64-decodable image data captured from the settings file. */
  backgroundData: string | null;
  logoData: string | null;
  logoMaskData: string | null;
  songStylePreferred: boolean;
  /** Misc OpenSong behavior flags worth preserving. */
  options: {
    initialMode: string;
    transition: boolean;
    transitionFrames: number;
    transitionTime: number;
    blankIsSlideChange: boolean;
    blankUsesNext: boolean;
  };
  warnings: string[];
}

function bool(v: unknown): boolean {
  return String(v ?? "") === "true";
}

function num(v: unknown, fallback: number): number {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function textStyle(el: unknown, base: TextStyle): TextStyle {
  const e = asRecord(el);
  return {
    font: resolveFont(asString(e["@_font"]) || base.font),
    size: num(e["@_size"], base.size),
    bold: bool(e["@_bold"]),
    italic: bool(e["@_italic"]),
    underline: bool(e["@_underline"]),
    color: asString(e["@_color"]) || base.color,
    align: (asString(e["@_align"]) || base.align) as TextStyle["align"],
    valign: (asString(e["@_valign"]) || base.valign) as TextStyle["valign"],
    border: bool(e["@_border"]),
    borderColor: asString(e["@_border_color"]) || base.borderColor,
    borderThickness: base.borderThickness,
    shadow: bool(e["@_shadow"]),
    shadowColor: asString(e["@_shadow_color"]) || base.shadowColor,
    fill: bool(e["@_fill"]),
    fillColor: asString(e["@_fill_color"]) || base.fillColor,
    enabled: e["@_enabled"] === undefined ? true : bool(e["@_enabled"]),
    autoScale: bool(e["@_auto_scale"]),
  };
}

/**
 * Parse an OpenSong PresentSettings file. Fonts pass through resolveFont —
 * legacy names (Helvetica, Arial…) map to bundled families.
 */
export function parsePresentSettings(xml: string): PresentSettingsResult {
  const warnings: string[] = [];
  const doc = parseXml(xml);
  const root = asRecord(asRecord(doc)["present_settings"]);
  if (Object.keys(root).length === 0) {
    throw new Error("Invalid PresentSettings: no <present_settings> root");
  }
  const styleEl = asRecord(root["style"]);
  const defaults = asRecord(root["default_style"]);
  const style = defaultSlideStyle();

  style.title = textStyle(defaults["title"], style.title);
  style.body = textStyle(defaults["body"], style.body);
  style.subtitle = textStyle(defaults["subtitle"], style.subtitle);
  style.descriptiveSubtitles = bool(asRecord(defaults["subtitle"])["@_descriptive"]);
  style.highlightChorus = bool(asRecord(defaults["body"])["@_highlight_chorus"]);

  // <background> sits inside <default_style>; <logo>/<logo_mask> are root strings.
  const bg = asRecord(defaults["background"]);
  style.backgroundColor = asString(bg["@_color"]) || style.backgroundColor;
  const bgData = asString(bg["#text"] ?? "") || null;
  style.backgroundKey = null; // media registered by the caller

  const logoData = asString(asRecord(root["logo"])["#text"] ?? root["logo"] ?? "");
  const maskData = asString(asRecord(root["logo_mask"])["#text"] ?? root["logo_mask"] ?? "");
  if (root["alert"] !== undefined) style.alert = textStyle(root["alert"], style.alert);

  const options = {
    initialMode: asString(styleEl["@_initial_mode"]) || "N",
    transition: bool(styleEl["@_transition"]),
    transitionFrames: num(styleEl["@_transition_frames"], 5),
    transitionTime: num(styleEl["@_transition_time"], 100),
    blankIsSlideChange: bool(styleEl["@_blank_is_slide_change"]),
    blankUsesNext: bool(styleEl["@_blank_uses_next"]),
  };
  style.transition = options.transition;
  style.transitionMs = options.transitionTime;

  return {
    style,
    backgroundData: bgData,
    logoData: logoData || null,
    logoMaskData: maskData || null,
    songStylePreferred: bool(asString(root["song_style_preferred"])),
    options,
    warnings,
  };
}

/** Per-role print styles (PrintSettings), for the M8 print engine. */
export function parsePrintSettings(xml: string): Record<string, TextStyle> {
  return parsePrintConfig(xml).roles;
}

/** Full print configuration: roles + layout spacing + style flags + page. */
export interface PrintConfig {
  roles: Record<string, TextStyle>;
  /** layout/<role>/@space_before|@space_after (pt). */
  spacing: Record<string, { before: number; after: number }>;
  capsSongTitle: boolean;
  highlightChorus: boolean;
  headerAdornment: boolean;
  borderThickness: number;
  /** Page box in points (OpenSong default: 612x792 letter, 72pt margins). */
  page: { width: number; height: number; margin: number };
}

/** MainSettings bits we use: custom labels for the user1-3 song fields. */
export function parseMainSettings(xml: string): { userFieldLabels: string[] } {
  const doc = parseXml(xml);
  const root = asRecord(asRecord(doc)["main_settings"] ?? asRecord(doc)["settings"]);
  const ud = asRecord(root["user_defined"]);
  return {
    userFieldLabels: [
      asString(ud["@_user1"]),
      asString(ud["@_user2"]),
      asString(ud["@_user3"]),
    ],
  };
}

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  roles: {},
  spacing: {},
  capsSongTitle: false,
  highlightChorus: false,
  headerAdornment: false,
  borderThickness: 1,
  page: { width: 612, height: 792, margin: 72 },
};

export function parsePrintConfig(xml: string): PrintConfig {
  const doc = parseXml(xml);
  const root = asRecord(asRecord(doc)["print_settings"]);
  const cfg = structuredClone(DEFAULT_PRINT_CONFIG);
  // Print roles are left-aligned by default (slice positions, not centered slides).
  const printBase: TextStyle = { ...defaultSlideStyle().body, align: "left" };
  for (const role of ["title", "author", "heading", "chords", "capo_chords", "lyrics", "lyrics_language2", "copyright"]) {
    const el = root[role];
    if (el !== undefined) cfg.roles[role] = textStyle(el, printBase);
  }
  const style = asRecord(root["style"]);
  const attr = (k: string) => asString(style[`@_${k}`]);
  if (attr("caps_song_title") !== "") cfg.capsSongTitle = bool(attr("caps_song_title"));
  if (attr("highlight_chorus") !== "") cfg.highlightChorus = bool(attr("highlight_chorus"));
  if (attr("header_adornment") !== "") cfg.headerAdornment = bool(attr("header_adornment"));
  const bt = Number.parseFloat(attr("border_thickness"));
  if (Number.isFinite(bt)) cfg.borderThickness = bt;
  const layout = asRecord(root["layout"]);
  for (const [k, v] of Object.entries(layout)) {
    const el = asRecord(v);
    const before = Number.parseFloat(asString(el["@_space_before"]));
    const after = Number.parseFloat(asString(el["@_space_after"]));
    cfg.spacing[k] = {
      before: Number.isFinite(before) ? before : 0,
      after: Number.isFinite(after) ? after : 0,
    };
  }
  const page = asRecord(root["page"]);
  const pw = Number.parseFloat(asString(page["@_width"]));
  const ph = Number.parseFloat(asString(page["@_height"]));
  const pl = Number.parseFloat(asString(page["@_left"]));
  if (Number.isFinite(pw) && Number.isFinite(ph)) {
    cfg.page = {
      width: pw,
      height: ph,
      margin: Number.isFinite(pl) ? pl : 72,
    };
  }
  return cfg;
}
