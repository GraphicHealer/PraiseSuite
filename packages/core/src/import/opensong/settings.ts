import { resolveFont } from "../../application/fonts.js";
import {
  defaultSlideStyle,
  type SlideStyle,
  type SlideStyleOverride,
  type TextStyle,
} from "../../domain/styles/types.js";
import { asRecord, asString, parseXml } from "./xml.js";

export interface PresentSettingsResult {
  style: SlideStyle;
  /** OpenSong <scripture_style> — the style applied to scripture groups. */
  scriptureStyle: SlideStyle | null;
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
    /** OpenSong style/@mouse_cursor on the present window (default hidden). */
    mouseCursor: string;
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
    ...(e["@_include_verse"] !== undefined ? { includeVerse: bool(e["@_include_verse"]) } : {}),
    // OpenSong @margin-* per element, px in the 640-unit design space.
    ...(e["@_margin-left"] !== undefined ? { marginLeft: num(e["@_margin-left"], 0) } : {}),
    ...(e["@_margin-right"] !== undefined ? { marginRight: num(e["@_margin-right"], 0) } : {}),
    ...(e["@_margin-top"] !== undefined ? { marginTop: num(e["@_margin-top"], 0) } : {}),
    ...(e["@_margin-bottom"] !== undefined ? { marginBottom: num(e["@_margin-bottom"], 0) } : {}),
    // OpenSong body/@multilanguage_* — second-language lines' size %/color.
    ...(e["@_multilanguage_size"] !== undefined ? { multilanguageSize: num(e["@_multilanguage_size"], 70) } : {}),
    ...(e["@_multilanguage_color"] !== undefined ? { multilanguageColor: asString(e["@_multilanguage_color"]) } : {}),
  };
}

/** OpenSong style/body/<tabs><tab position align char> — tab stops. */
function parseTabs(bodyEl: unknown): import("../../domain/styles/types.js").StyleTab[] {
  const tabs = asRecord(asRecord(bodyEl)["tabs"])["tab"];
  const list = tabs === undefined ? [] : Array.isArray(tabs) ? tabs : [tabs];
  return list
    .map((t) => {
      const e = asRecord(t);
      const a = asString(e["@_align"]) || "left";
      return {
        position: num(e["@_position"], 0),
        align: (a === "center" || a === "right" || a === "char" ? a : "left") as "left" | "center" | "right" | "char",
        ...(asString(e["@_char"]) !== "" ? { char: asString(e["@_char"]) } : {}),
      };
    })
    .filter((t) => t.position > 0);
}

/** Shared: background element attrs -> style fields. */
function parseBackgroundAttrs(
  bg: Record<string, unknown>,
  style: Pick<SlideStyle, "backgroundFit" | "backgroundStripFooter" | "backgroundPosX" | "backgroundPosY">,
): void {
  // OpenSong ObjectFit enum: cover=0 contain=1 fill=2 none/center=3|99.
  const fit = num(bg["@_image_fit"], -1);
  if (fit === 0 || fit === 1 || fit === 2) style.backgroundFit = fit === 1 ? "contain" : fit === 2 ? "fill" : "cover";
  else if (fit === 3 || fit === 99) style.backgroundFit = "center";
  style.backgroundStripFooter = num(bg["@_strip_footer"], style.backgroundStripFooter);
  // image_pos_* are 0..1 anchor fractions (StyleImage.ImagePositionW/H).
  if (bg["@_image_pos_left"] !== undefined) style.backgroundPosX = num(bg["@_image_pos_left"], style.backgroundPosX);
  if (bg["@_image_pos_top"] !== undefined) style.backgroundPosY = num(bg["@_image_pos_top"], style.backgroundPosY);
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

  // <default_style> and <scripture_style> share the full SlideStyle XML shape.
  const parseStyleEl = (el: unknown): SlideStyle => {
    const e = asRecord(el);
    const style = defaultSlideStyle();
    style.title = textStyle(e["title"], style.title);
    style.body = textStyle(e["body"], style.body);
    style.subtitle = textStyle(e["subtitle"], style.subtitle);
    style.descriptiveSubtitles = bool(asRecord(e["subtitle"])["@_descriptive"]);
    style.highlightChorus = bool(asRecord(e["body"])["@_highlight_chorus"]);
    const bg = asRecord(e["background"]);
    style.backgroundColor = asString(bg["@_color"]) || style.backgroundColor;
    style.backgroundKey = asString(bg["@_filename"]) || null;
    parseBackgroundAttrs(bg, style);
    style.bodyTabs = parseTabs(e["body"]);
    // <song_subtitle> text = '|'-joined field keys (author|copyright|…).
    const songSub = asString(asRecord(e["song_subtitle"])["#text"] ?? e["song_subtitle"]);
    if (songSub !== "") style.songSubtitle = songSub.split("|").filter((s) => s !== "");
    return style;
  };

  const defaults = asRecord(root["default_style"]);
  const style = parseStyleEl(defaults);
  // <background> image data (base64 text) — registered as media by the caller.
  const bgData = asString(asRecord(defaults["background"])["#text"] ?? "") || null;
  style.backgroundKey = null; // media registered by the caller
  const scriptureStyle = root["scripture_style"] !== undefined ? parseStyleEl(root["scripture_style"]) : null;

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
    mouseCursor: asString(styleEl["@_mouse_cursor"]) || "hidden",
  };
  style.transition = options.transition;
  style.transitionMs = options.transitionTime;
  style.initialMode = options.initialMode;
  // GraphicsX.ThicknessFactor is a global multiplier applied to every font's
  // border (TextHeight*thickness/40) and shadow (/50) radius.
  const thickness = num(styleEl["@_thickness"], style.thickness);
  style.thickness = thickness;
  for (const f of [style.title, style.body, style.subtitle, style.alert]) f.borderThickness = thickness;

  return {
    style,
    scriptureStyle,
    backgroundData: bgData,
    logoData: logoData || null,
    logoMaskData: maskData || null,
    // OpenSong GetValueB(…, True) — song_style_preferred defaults true.
    songStylePreferred:
      root["song_style_preferred"] === undefined
        ? true
        : bool(asString(root["song_style_preferred"])),
    options,
    warnings,
  };
}

/**
 * Parse a <slide_group><style> node (per-item override / style-change item)
 * into a deep-partial SlideStyleOverride — same XML shape as default_style.
 */
export function parseStyleOverride(el: unknown): SlideStyleOverride {
  const e = asRecord(el);
  const base = defaultSlideStyle();
  const out: SlideStyleOverride = {};
  if (e["title"] !== undefined) out.title = textStyle(e["title"], base.title);
  if (e["body"] !== undefined) out.body = textStyle(e["body"], base.body);
  if (e["subtitle"] !== undefined) out.subtitle = textStyle(e["subtitle"], base.subtitle);
  if (e["subtitle"] !== undefined && asRecord(e["subtitle"])["@_descriptive"] !== undefined)
    out.descriptiveSubtitles = bool(asRecord(e["subtitle"])["@_descriptive"]);
  if (e["body"] !== undefined && asRecord(e["body"])["@_highlight_chorus"] !== undefined)
    out.highlightChorus = bool(asRecord(e["body"])["@_highlight_chorus"]);
  const songSub = asString(asRecord(e["song_subtitle"])["#text"] ?? e["song_subtitle"]);
  if (songSub !== "") out.songSubtitle = songSub.split("|").filter((s) => s !== "");
  const tabs = parseTabs(e["body"]);
  if (tabs.length > 0) out.bodyTabs = tabs;
  const bg = asRecord(e["background"]);
  if (bg["@_color"] !== undefined) out.backgroundColor = asString(bg["@_color"]);
  const bgFile = asString(bg["@_filename"]);
  if (bgFile !== "") out.backgroundKey = bgFile;
  else if (asString(bg["#text"] ?? "") !== "") out.backgroundKey = asString(bg["#text"]);
  const holder = { backgroundFit: base.backgroundFit, backgroundStripFooter: 0, backgroundPosX: base.backgroundPosX, backgroundPosY: base.backgroundPosY };
  const hadPos = bg["@_image_pos_left"] !== undefined || bg["@_image_pos_top"] !== undefined;
  parseBackgroundAttrs(bg, holder);
  if (bg["@_image_fit"] !== undefined) out.backgroundFit = holder.backgroundFit;
  if (bg["@_strip_footer"] !== undefined) out.backgroundStripFooter = holder.backgroundStripFooter;
  if (hadPos) {
    out.backgroundPosX = holder.backgroundPosX;
    out.backgroundPosY = holder.backgroundPosY;
  }
  return out;
}

/** Per-role print styles (PrintSettings), for the M8 print engine. */
export function parsePrintSettings(xml: string): Record<string, TextStyle> {
  return parsePrintConfig(xml).roles;
}

/** Runtime visibility toggles (OpenSong PrintSettingsWindow checkboxes). */
export interface PrintVisibility {
  /** "Print chords" off = lyric lines only. */
  hideChords: boolean;
  /** "Print capo chords" off = no capo fingering row. */
  hideCapo: boolean;
  /** "Print 2nd language lyrics" off = lang2 lines skipped. */
  hideLang2: boolean;
  /** "Print presentation order" = sections in arrangement sequence. */
  presentationOrder: boolean;
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
  page: { width: number; height: number; top: number; right: number; bottom: number; left: number };
  /** PrintSettingsWindow visibility toggles (request-level overrides). */
  options?: PrintVisibility | undefined;
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
  capsSongTitle: true,
  highlightChorus: true,
  headerAdornment: false,
  borderThickness: 2,
  page: { width: 612, height: 792, top: 72, right: 72, bottom: 72, left: 72 },
};

/** OpenSong's own PrintSettings defaults (Settings/PrintSettings fixture).
 *  Slide-body colors are presentation chrome (white on dark) — print roles
 *  reset to black-on-paper explicitly or lyrics print white-on-white. */
const printRoleBase = (): TextStyle => ({
  ...defaultSlideStyle().body,
  align: "left",
  color: "#000000",
  bold: false,
  italic: false,
  underline: false,
});
export const PRINT_ROLE_DEFAULTS: Record<string, TextStyle> = {
  title: { ...printRoleBase(), font: "Arial", size: 20, bold: true },
  author: { ...printRoleBase(), font: "Times New Roman", size: 12, italic: true },
  heading: { ...printRoleBase(), font: "Arial", size: 10, bold: true, color: "#800000" },
  chords: { ...printRoleBase(), font: "Times New Roman", size: 11, bold: true, color: "#000080" },
  capo_chords: { ...printRoleBase(), font: "Times New Roman", size: 10, italic: true, color: "#008000" },
  lyrics: { ...printRoleBase(), font: "Arial Narrow", size: 12 },
  lyrics_language2: { ...printRoleBase(), font: "Arial Narrow", size: 8 },
  copyright: { ...printRoleBase(), font: "Courier New", size: 9, italic: true },
};

/**
 * Merge a stored/partial print config onto the OpenSong defaults. A shallow
 * spread drops every role/spacing the stored object doesn't mention (leaving
 * print docs with empty styles) — roles merge field-by-field per role.
 */
export function mergePrintConfig(overrides: Partial<PrintConfig> = {}): PrintConfig {
  const roles: Record<string, TextStyle> = { ...PRINT_ROLE_DEFAULTS };
  for (const [name, style] of Object.entries(overrides.roles ?? {})) {
    roles[name] = { ...(roles[name] ?? printRoleBase()), ...style };
  }
  return {
    ...DEFAULT_PRINT_CONFIG,
    ...overrides,
    roles,
    spacing: { ...DEFAULT_PRINT_CONFIG.spacing, ...(overrides.spacing ?? {}) },
    page: { ...DEFAULT_PRINT_CONFIG.page, ...(overrides.page ?? {}) },
  };
}

/**
 * Per-request print overrides (print-window options panel). Query params:
 * `r_<role>_<font|size|color|bold|italic|underline>` for any of the 8 roles;
 * `margin`/`capsTitle`/`chorus`/`adorn`/`border` for page & style flags;
 * `hideChords`/`hideCapo`/`hideLang2`/`order` visibility toggles;
 * `landscape` swaps the page box dimensions.
 */
export function applyPrintOverrides(cfg: PrintConfig, q: URLSearchParams | Record<string, string | undefined>): PrintConfig {
  cfg = structuredClone(cfg);
  const entries: [string, string][] =
    q instanceof URLSearchParams ? [...q.entries()] : Object.entries(q).filter((e): e is [string, string] => e[1] !== undefined);
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) ?? undefined : q[k]);
  const bool = (v: string | undefined) => v === "1" || v === "true";
  const num = (v: string | undefined) => {
    if (v === undefined) return undefined;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const ROLE_PROPS = new Set(["font", "size", "color", "bold", "italic", "underline"]);
  for (const [k, v] of entries) {
    const m = /^r_([a-z_0-9]+)_(font|size|color|bold|italic|underline)$/.exec(k);
    if (!m) continue;
    const [, name, prop] = m as unknown as [string, string, keyof Pick<TextStyle, "font" | "size" | "color" | "bold" | "italic" | "underline">];
    if (!ROLE_PROPS.has(prop)) continue;
    const base = cfg.roles[name] ?? PRINT_ROLE_DEFAULTS[name];
    if (!base) continue;
    const role = { ...(cfg.roles[name] ?? base) };
    if (prop === "size") {
      const n = num(v);
      if (n === undefined) continue;
      role.size = n;
    } else if (prop === "bold" || prop === "italic" || prop === "underline") {
      role[prop] = bool(v);
    } else {
      role[prop] = v;
    }
    cfg.roles[name] = role;
  }

  const margin = num(get("margin"));
  if (margin !== undefined) cfg.page = { ...cfg.page, top: margin, right: margin, bottom: margin, left: margin };
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const v = num(get(`margin${side.charAt(0).toUpperCase()}${side.slice(1)}`));
    if (v !== undefined) cfg.page = { ...cfg.page, [side]: v };
  }
  if (bool(get("landscape"))) {
    const { width, height } = cfg.page;
    if (height > width) cfg.page = { ...cfg.page, width: height, height: width };
  }
  if (get("capsTitle") !== undefined) cfg.capsSongTitle = bool(get("capsTitle"));
  if (get("chorus") !== undefined) cfg.highlightChorus = bool(get("chorus"));
  if (get("adorn") !== undefined) cfg.headerAdornment = bool(get("adorn"));
  const border = num(get("border"));
  if (border !== undefined) cfg.borderThickness = border;

  cfg.options = {
    hideChords: bool(get("hideChords")),
    hideCapo: bool(get("hideCapo")),
    hideLang2: bool(get("hideLang2")),
    presentationOrder: bool(get("order")),
  };
  return cfg;
}

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
  const side = (name: string) => {
    const v = Number.parseFloat(asString(page[`@_${name}`]));
    return Number.isFinite(v) ? v : 72;
  };
  if (Number.isFinite(pw) && Number.isFinite(ph)) {
    cfg.page = { width: pw, height: ph, top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
  }
  return cfg;
}
