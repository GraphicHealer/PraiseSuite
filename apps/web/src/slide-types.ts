/** Slide style wire types (mirror of packages/core domain/styles). */
export interface TextStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  border: boolean;
  borderColor: string;
  borderThickness: number;
  shadow: boolean;
  shadowColor: string;
  fill: boolean;
  fillColor: string;
  enabled: boolean;
  autoScale: boolean;
  includeVerse?: boolean;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
  /** OpenSong body/@multilanguage_size — lang-2 lines at this % of body size. */
  multilanguageSize?: number;
  /** OpenSong body/@multilanguage_color — lang-2 line color. */
  multilanguageColor?: string;
}

/** OpenSong style/body/<tabs><tab> — a tab stop for lines containing \t. */
export interface StyleTab {
  position: number;
  align: "left" | "center" | "right" | "char";
  char?: string;
}

export interface SlideStyle {
  title: TextStyle;
  body: TextStyle;
  subtitle: TextStyle;
  alert: TextStyle;
  descriptiveSubtitles: boolean;
  highlightChorus: boolean;
  backgroundColor: string;
  backgroundKey: string | null;
  logoKey: string | null;
  margin: number;
  transition: boolean;
  transitionMs: number;
  songSubtitle: string[];
  initialMode: string;
  backgroundFit: "cover" | "contain" | "fill" | "center";
  backgroundStripFooter: number;
  /** OpenSong background/@image_pos_left|top — 0..1 anchor within the slide. */
  backgroundPosX?: number;
  backgroundPosY?: number;
  /** OpenSong style/body/<tabs> — tab stops for \t-containing lines. */
  bodyTabs?: StyleTab[];
}
