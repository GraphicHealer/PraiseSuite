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
}
