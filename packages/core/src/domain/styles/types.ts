/** Text styling for one slide element (title/body/subtitle) — OpenSong parity. */
export interface TextStyle {
  /** Resolved font family name (via the font-resolution map — never a legacy platform name). */
  font: string;
  /** Point size, or max size when autoScale. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string; // #RRGGBB
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  border: boolean;
  borderColor: string;
  borderThickness: number;
  shadow: boolean;
  shadowColor: string;
  /** Text-block fill (highlight behind the text area). */
  fill: boolean;
  fillColor: string;
  enabled: boolean;
  /** Auto-scale text down/up to fit the slide area (OpenSong auto_scale). */
  autoScale: boolean;
  /** OpenSong title/@include_verse — append the verse map to the title. */
  includeVerse?: boolean;
  /** OpenSong @margin-* per element, px in the 640-unit design space. */
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
}

export interface SlideStyle {
  title: TextStyle;
  body: TextStyle;
  subtitle: TextStyle;
  /** Alert overlay styling (OpenSong <alert>). */
  alert: TextStyle;
  /** Subtitles show descriptive text (OpenSong subtitle.descriptive) vs song name. */
  descriptiveSubtitles: boolean;
  highlightChorus: boolean;
  backgroundColor: string;
  /** FileStore key for a background image, or null for color-only. */
  backgroundKey: string | null;
  /** FileStore key for the logo image (logo mode). */
  logoKey: string | null;
  /** Inset margin in px around the slide area. */
  margin: number;
  transition: boolean;
  transitionMs: number;
  /** OpenSong style/@thickness — global factor scaling every font's
   *  border (TextHeight*thickness/40 px) and shadow (/50) radius. */
  thickness: number;
  /** OpenSong <song_subtitle> — '|'-joined field keys composing song subtitles
   *  (copyright|hymn_number|author|ccli_number|ccli_license). */
  songSubtitle: string[];
  /** OpenSong style/@initial_mode — the mode a presentation starts in. */
  initialMode: string;
  /** OpenSong background/@image_fit: cover(0)|contain(1)|fill(2)|center(3/99). */
  backgroundFit: "cover" | "contain" | "fill" | "center";
  /** OpenSong background/@strip_footer — px cropped off the image bottom. */
  backgroundStripFooter: number;
}

/** Deep-partial override applied at service-item or slide level. */
export type TextStyleOverride = Partial<TextStyle>;
export interface SlideStyleOverride {
  title?: TextStyleOverride;
  body?: TextStyleOverride;
  subtitle?: TextStyleOverride;
  backgroundColor?: string;
  backgroundKey?: string | null;
  margin?: number;
}

export function defaultTextStyle(over: Partial<TextStyle> = {}): TextStyle {
  return {
    font: "Inter",
    size: 34,
    bold: true,
    italic: false,
    underline: false,
    color: "#FFFFFF",
    align: "center",
    valign: "middle",
    border: true,
    borderColor: "#000000",
    borderThickness: 2,
    shadow: true,
    shadowColor: "#000000",
    fill: false,
    fillColor: "#000000",
    enabled: true,
    autoScale: true,
    ...over,
  };
}

export function defaultSlideStyle(): SlideStyle {
  return {
    title: defaultTextStyle({ size: 26, italic: true, valign: "bottom", autoScale: false }),
    body: defaultTextStyle({ size: 34 }),
    subtitle: defaultTextStyle({ size: 18, italic: true, valign: "bottom", autoScale: false }),
    // OpenSong default alert: 40pt bold, red fill, left/top.
    alert: defaultTextStyle({ size: 40, bold: true, border: false, shadow: false, fill: true, fillColor: "#FF0000", align: "left", valign: "top" }),
    descriptiveSubtitles: false,
    highlightChorus: true,
    backgroundColor: "#408080",
    backgroundKey: null,
    logoKey: null,
    margin: 24,
    transition: true,
    transitionMs: 100,
    thickness: 2,
    songSubtitle: ["author"],
    initialMode: "N",
    backgroundFit: "cover",
    backgroundStripFooter: 0,
  };
}
