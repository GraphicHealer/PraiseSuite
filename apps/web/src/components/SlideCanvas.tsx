import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

// OpenSong's single transition is a crossfade: the old frame fades out
// over the new one. Injected once; duration comes from @transition_time.
const FADE_CSS = "@keyframes psSlideFadeOut{from{opacity:1}to{opacity:0}}";
let fadeCssInjected = false;
function injectFadeCss() {
  if (fadeCssInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = FADE_CSS;
  document.head.appendChild(el);
  fadeCssInjected = true;
}
import { fontStack } from "../fonts";
import type { PresentMode } from "../api.js";
import type { SlideStyle, StyleTab, TextStyle } from "../slide-types";

/** Canonical output size — everything draws in these pixels, then scales. */
const DESIGN_W = 1920;
const DESIGN_H = 1080;

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const isVideo = (key: string) => VIDEO_EXT.test(key);

function mediaUrl(key: string): string {
  return `/api/v1/media/${encodeURIComponent(key.split("/").pop() ?? key)}`;
}

/**
 * OpenSong draws into a 640-unit design space: SetML.DrawSlide uses
 * `zoom = gWidth / 640` and `FontFace.OntoGraphics` sets
 * `TextSize = size * zoom` (FontUnit Point at 72dpi = px). So a style
 * "size" is 1/640th of the output width — 34 → 102px at 1920.
 */
const ZOOM = DESIGN_W / 640;
/** OpenSong RealBorder = g.Width / 50 — the global inset around text areas. */
const REAL_BORDER = DESIGN_W / 50;

/** Halve RGB brightness — OpenSong paints the shadow in a DarkerColor. */
function darker(hex: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] ?? "0", 16);
  return `rgb(${((n >> 16) & 0xff) >> 1},${((n >> 8) & 0xff) >> 1},${(n & 0xff) >> 1})`;
}

/** Border radius — OpenSong CalcBorderSize: max(round(TextHeight×thickness/40),1). */
function borderRadiusPx(s: TextStyle, zoom: number): number {
  if (!s.border) return 0;
  const textH = s.size * zoom * ZOOM * 1.2;
  return Math.max(Math.round((textH * s.borderThickness) / 40), 1);
}
/** Shadow offset — OpenSong CalcShadowSize: max(round(TextHeight×thickness/50),1). */
function shadowOffsetPx(s: TextStyle, zoom: number): number {
  if (!s.shadow) return 0;
  const textH = s.size * zoom * ZOOM * 1.2;
  return Math.max(Math.round((textH * s.borderThickness) / 50), 1);
}

/**
 * OpenSong DrawFontSingleLine border: the text is re-drawn at every offset of
 * a diamond ring of radius borderSize — flat runs along the four sides plus a
 * diagonal staircase filling the corners — producing a continuous outline.
 * (Four corner shadows leave gaps on curved/diagonal glyph edges.)
 */
function outlineOffsets(r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const b2 = Math.floor(r / 2);
  for (let dx = -b2; dx <= b2; dx++) {
    out.push([dx, -r], [dx, r], [-r, dx], [r, dx]);
  }
  let dy = 1 - r;
  for (let dx = b2 + 1; dx < r; dx++) {
    out.push([dx, dy], [dx, -dy], [-dx, dy], [-dx, -dy]);
    dy += 1;
  }
  return out;
}

function textCss(s: TextStyle, zoom = 1): CSSProperties {
  const r = borderRadiusPx(s, zoom);
  const sh = shadowOffsetPx(s, zoom);
  const shadows: string[] = [];
  if (r > 0) for (const [dx, dy] of outlineOffsets(r)) shadows.push(`${dx}px ${dy}px 0 ${s.borderColor}`);
  if (sh > 0) shadows.push(`${sh}px ${sh}px 0 ${darker(s.shadowColor)}`);
  return {
    fontFamily: fontStack(s.font),
    fontSize: s.size * zoom * ZOOM,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textDecoration: s.underline ? "underline" : "none",
    color: s.color,
    textAlign: s.align,
    // OpenSong g.CharacterSpacing = 2·Border + Shadow (design units).
    letterSpacing: r || sh ? ((r ? 2 : 0) + (sh ? 1 : 0)) * zoom * ZOOM : undefined,
    textShadow: shadows.join(", ") || "none",
  };
}

/** OpenSong FontFaceHeight = TextHeight + 2·border + shadow — extra leading for decorations. */
function lineLeading(s: TextStyle, zoom = 1): number {
  return 2 * borderRadiusPx(s, zoom) + shadowOffsetPx(s, zoom);
}

/** Second-language font (OpenSong SlideStyle.SecondLanguageFont): the body
 *  font at multilanguage_size percent in multilanguage_color. */
function lang2Style(body: TextStyle): TextStyle {
  return {
    ...body,
    size: body.size * ((body.multilanguageSize ?? 70) / 100),
    color: body.multilanguageColor ?? "#DCDCDC",
  };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measureTextW(text: string, fontSpec: string): number {
  if (typeof document === "undefined") return text.length * 20;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 20;
  measureCtx.font = fontSpec;
  return measureCtx.measureText(text).width;
}

/**
 * OpenSong tab-stop layout (GraphicsX.DrawFontString): each \t-separated
 * segment lands at the first stop right of the running x; stops it already
 * passed are skipped. Positions are 640-units -> design px.
 */
function layoutTabs(
  line: string,
  stops: StyleTab[],
  s: TextStyle,
  zoom: number,
): { segs: { text: string; left: number }[]; width: number } {
  const px = (u: number) => u * ZOOM * zoom;
  const sizePx = s.size * ZOOM * zoom;
  const fontSpec = `${s.italic ? "italic " : ""}${s.bold ? "700" : "400"} ${sizePx}px ${fontStack(s.font)}`;
  const w = (t: string) => measureTextW(t, fontSpec);
  const parts = line.split("\t");
  const segs: { text: string; left: number }[] = [];
  let x = 0;
  let idx = -1;
  for (const [i, part] of parts.entries()) {
    const pw = w(part);
    if (i === 0) {
      segs.push({ text: part, left: 0 });
      x = pw;
      continue;
    }
    let stop: StyleTab | undefined;
    for (let k = idx + 1; k < stops.length; k++) {
      if (px(stops[k]!.position) > x) {
        stop = stops[k]!;
        idx = k;
        break;
      }
    }
    const edge =
      stop === undefined
        ? x
        : stop.align === "right"
          ? px(stop.position) - pw
          : stop.align === "center"
            ? px(stop.position) - pw / 2
            : px(stop.position);
    segs.push({ text: part, left: edge });
    x = edge + pw;
  }
  return { segs, width: x };
}

/**
 * One slide rendered exactly as the receiver draws it — 1920×1080 design
 * space transform-scaled to whatever container it sits in, so the helper
 * previews and the real output are pixel-identical. Implements OpenSong's
 * body/@auto_scale (BodyScale): oversized slides shrink until they fit the
 * usable body area; undersized slides keep the configured font size.
 */
export function SlideCanvas({
  title,
  lines,
  langs,
  style,
  backgroundKey,
  backgroundAsText,
  mediaKey,
  logoKey,
  mode = "normal",
  blanked = false,
  alert,
  index,
  total,
  subtitle,
  emphasize = false,
  verseMap,
  transition = 0,
  imageResize = "",
  imageKeepAspect = true,
}: {
  title: string;
  lines: string[];
  /** Bilingual (L) sections: per-line language 1|2 (OpenSong multilanguage). */
  langs?: (1 | 2)[] | undefined;
  style: SlideStyle | undefined;
  backgroundKey?: string | null | undefined;
  backgroundAsText?: boolean | undefined;
  mediaKey?: string | null | undefined;
  logoKey?: string | null | undefined;
  mode?: PresentMode | undefined;
  blanked?: boolean | undefined;
  alert?: string | null | undefined;
  index?: number | undefined;
  total?: number | undefined;
  /** OpenSong slide_group <subtitle> — multi-line, stacked at its valign. */
  subtitle?: string | null | undefined;
  /** OpenSong slide @emphasize — chorus inversion under body/@highlight_chorus. */
  emphasize?: boolean | undefined;
  /** OpenSong title/@include_verse — "name: 1, 2, **3**, 4". */
  verseMap?: { prev: string[]; curr: string; rest: string[] } | null | undefined;
  /** OpenSong slide_group @transition — 0=style default, 1=force on, 2=off. */
  transition?: number | undefined;
  /** OpenSong image-group @resize ("screen"|"body"|"") and @keep_aspect. */
  imageResize?: string | undefined;
  imageKeepAspect?: boolean | undefined;
}): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  injectFadeCss();
  const [box, setBox] = useState({ w: DESIGN_W, h: DESIGN_H });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth || DESIGN_W, h: el.clientHeight || DESIGN_H });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inset = REAL_BORDER + (style?.margin ?? 0);
  const availW = DESIGN_W - inset * 2 - ((style?.body.marginLeft ?? 0) + (style?.body.marginRight ?? 0)) * ZOOM;
  // MainHeight = screen − header/footer — title and subtitle claim their space first.
  const headerH = style?.title.enabled ? style.title.size * ZOOM * 1.3 + lineLeading(style.title) : 0;
  const footerH = style?.subtitle.enabled ? style.subtitle.size * ZOOM * 1.3 + lineLeading(style.subtitle) : 0;
  const availH = DESIGN_H - inset * 2 - headerH - footerH;

  // BodyScale: measure the text at zoom 1 and shrink until it fits. The
  // measured zoom is keyed to the content it was measured for — until the
  // layout effect runs for new lines, the body renders hidden rather than
  // at the unscaled (huge) size for a frame.
  const linesKey = `${lines.join("")}|${availW.toFixed(0)}x${availH.toFixed(0)}`;
  const [zoomState, setZoomState] = useState({ key: "", z: 1 });
  useLayoutEffect(() => {
    const el = measureRef.current;
    const z =
      !el || !style || !style.body.autoScale
        ? 1
        : Math.min(
            1,
            availH / Math.max(1, el.scrollHeight),
            availW / Math.max(1, el.scrollWidth),
          );
    setZoomState((s) => (s.key === linesKey && s.z === z ? s : { key: linesKey, z }));
  }, [lines, style, availW, availH, linesKey]);
  const bodyZoom = zoomState.key === linesKey ? zoomState.z : 1;
  const bodyMeasured = !style?.body.autoScale || zoomState.key === linesKey;

  const scale = box.w / DESIGN_W;
  const black = blanked || mode === "blank" || !style;
  const white = mode === "white";
  const hidden = mode === "hidden";
  const logo = mode === "logo";
  const bg = backgroundKey ? mediaUrl(backgroundKey) : null;
  // OpenSong body/@highlight_chorus flips italic on emphasized (chorus) slides.
  const bodyStyle: TextStyle | undefined = style
    ? { ...style.body, italic: emphasize && style.highlightChorus ? !style.body.italic : style.body.italic }
    : undefined;

  const justify =
    style?.body.valign === "top" ? "flex-start" : style?.body.valign === "bottom" ? "flex-end" : "center";
  const align =
    style?.body.align === "left" ? "flex-start" : style?.body.align === "right" ? "flex-end" : "center";

  // OpenSong stacks by valign: title/subtitle default valign=bottom → they
  // sit at the bottom (title above subtitle); body centers in what remains.
  /** OpenSong @margin-* per element, px@640 -> design px. */
  const margins = (t: TextStyle | undefined): string =>
    `${(t?.marginTop ?? 0) * ZOOM}px ${(t?.marginRight ?? 0) * ZOOM}px ${(t?.marginBottom ?? 0) * ZOOM}px ${(t?.marginLeft ?? 0) * ZOOM}px`;
  const titleEl = style?.title.enabled ? (
    <div style={{ ...textCss(style.title), padding: margins(style.title) }}>
      {verseMap ? (
        <>
          {title}: {verseMap.prev.join(", ")}{verseMap.prev.length > 0 ? ", " : ""}
          <b>{verseMap.curr}</b>
          {verseMap.rest.length > 0 ? ", " : ""}{verseMap.rest.join(", ")}
        </>
      ) : (
        title
      )}
    </div>
  ) : null;
  // OpenSong stacks subtitle lines at its valign (bottom → below title, source order).
  const subtitleLines = (subtitle ?? "").split("\n").filter((l) => l !== "");
  const subtitleEl = style?.subtitle.enabled && subtitleLines.length > 0 ? (
    <div style={{ ...textCss(style.subtitle), padding: margins(style.subtitle) }}>
      {subtitleLines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  ) : null;

  const body = style && (
    <div className="absolute inset-0 flex flex-col" style={{ padding: inset }}>
      {style.title.valign === "top" && titleEl}
      {style.subtitle.valign === "top" && subtitleEl}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ justifyContent: justify, alignItems: align, padding: margins(style.body), visibility: bodyMeasured ? "visible" : "hidden" }}
      >
        <div className="max-w-full" style={{ display: "flex", flexDirection: "column" }}>
          {lines.map((l, i) => {
            // Bilingual "L" sections: lang-2 lines draw in the
            // multilanguage font (OpenSong SecondLanguageFont).
            const ls = langs?.[i] === 2 && bodyStyle ? lang2Style(bodyStyle) : bodyStyle!;
            const css = { ...textCss(ls, bodyZoom), lineHeight: 1.2, margin: 0, marginBottom: lineLeading(ls, bodyZoom) };
            // OpenSong body <tabs>: \t-separated segments land on tab stops
            // (only under left alignment, like DrawFontString).
            if (l.includes("\t") && style.body.align === "left" && (style.bodyTabs?.length ?? 0) > 0) {
              const t = layoutTabs(l, style.bodyTabs!, ls, bodyZoom);
              return (
                <p key={i} style={{ ...css, position: "relative", width: t.width, whiteSpace: "pre" }}>
                  {t.segs.map((seg, j) =>
                    j === 0 ? (
                      seg.text
                    ) : (
                      <span key={j} style={{ position: "absolute", left: seg.left, top: 0 }}>
                        {seg.text}
                      </span>
                    ),
                  )}
                </p>
              );
            }
            return (
              <p key={i} style={css}>
                {l}
              </p>
            );
          })}
        </div>
      </div>
      {style.title.valign !== "top" && titleEl}
      {style.subtitle.valign !== "top" && subtitleEl}
    </div>
  );

  // OpenSong transition: one crossfade — the previous frame fades out over
  // the new frame for style/@transition_time ms. Per-item @transition:
  // 0 = follow the style flag, 1 = force on, 2 = force off.
  const transitionMs =
    transition === 2 ? 0 : transition === 1 || (style?.transition ?? false) ? style?.transitionMs ?? 0 : 0;
  const frame = (
    <>
      {!black && !white && (
        <>
          {bg && isVideo(backgroundKey ?? "") ? (
            <video key={bg} src={bg} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" />
          ) : bg ? (
            // OpenSong background/@image_fit (cover|contain|fill|center) and
            // @image_pos_left|@image_pos_top anchor (0..1 -> object-position).
            <img
              src={bg}
              alt=""
              className={`absolute inset-0 h-full w-full ${
                style?.backgroundFit === "contain" ? "object-contain" : style?.backgroundFit === "fill" ? "object-fill" : "object-cover"
              }`}
              style={
                style?.backgroundFit === "center"
                  ? {
                      width: "auto", height: "auto",
                      left: `${(style?.backgroundPosX ?? 0.5) * 100}%`, top: `${(style?.backgroundPosY ?? 0.5) * 100}%`,
                      transform: `translate(-${(style?.backgroundPosX ?? 0.5) * 100}%,-${(style?.backgroundPosY ?? 0.5) * 100}%)`,
                    }
                  : { objectPosition: `${(style?.backgroundPosX ?? 0.5) * 100}% ${(style?.backgroundPosY ?? 0.5) * 100}%` }
              }
            />
          ) : (
            <div className="absolute inset-0" style={{ backgroundColor: style?.backgroundColor ?? "#000" }} />
          )}
        </>
      )}
      {white && <div className="absolute inset-0 bg-white" />}
      {mediaKey && !black && !white && !logo && (
        // OpenSong image-group @resize: "screen" fills the canvas, "body"
        // fits inside the text area, "" draws natural size centered;
        // @keep_aspect decides fit vs stretch.
        (() => {
          const cls = `absolute inset-0 h-full w-full bg-black ${
            imageResize === "" ? "" : imageKeepAspect
              ? imageResize === "screen" ? "object-cover" : "object-contain"
              : "object-fill"
          }`;
          const sty = imageResize === "" ? { width: "auto", height: "auto", top: "50%", left: "50%", transform: "translate(-50%,-50%)" } : undefined;
          return isVideo(mediaKey) ? (
            <video key={mediaKey} src={mediaUrl(mediaKey)} autoPlay loop muted playsInline className={cls} style={sty} />
          ) : (
            <img src={mediaUrl(mediaKey)} alt="" className={cls} style={sty} />
          );
        })()
      )}
      {logo && logoKey && !black && !white && (
        // OpenSong mode "L": the style background shows, logo centered shrink-only.
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={mediaUrl(logoKey)} alt="logo" style={{ maxHeight: "100%", maxWidth: "100%" }} />
        </div>
      )}
      {!black && !white && !hidden && !logo && !(backgroundAsText && bg) && body}
    </>
  );
  const prevFrameRef = useRef<ReactNode>(null);
  const prevIndexRef = useRef(index);
  const [fadingFrame, setFadingFrame] = useState<ReactNode>(null);
  // The fade snapshot is taken post-commit so it always holds the last
  // *settled* frame — assigning in render could freeze an intermediate
  // (pre-BodyScale) frame into the overlay.
  useEffect(() => {
    if (index === prevIndexRef.current) {
      prevFrameRef.current = frame;
      return;
    }
    prevIndexRef.current = index;
    if (transitionMs > 0 && prevFrameRef.current !== null) {
      setFadingFrame(prevFrameRef.current);
      const t = setTimeout(() => setFadingFrame(null), transitionMs);
      prevFrameRef.current = frame;
      return () => clearTimeout(t);
    }
    prevFrameRef.current = frame;
  });

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden bg-black">
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})` }}
      >
        {/* Hidden measurement pass for BodyScale (rendered at zoom 1). */}
        {style?.body.autoScale && (
          <div
            ref={measureRef}
            aria-hidden
            className="invisible absolute top-0 left-0"
            style={{ width: availW, display: "flex", flexDirection: "column" }}
          >
            {lines.map((l, i) => {
              const ls = langs?.[i] === 2 && bodyStyle ? lang2Style(bodyStyle) : bodyStyle!;
              const css = { ...textCss(ls), lineHeight: 1.2, margin: 0, marginBottom: lineLeading(ls), whiteSpace: "pre-wrap" as const };
              if (l.includes("\t") && style.body.align === "left" && (style.bodyTabs?.length ?? 0) > 0) {
                const t = layoutTabs(l, style.bodyTabs!, ls, 1);
                return (
                  <p key={i} style={{ ...css, position: "relative", width: t.width, whiteSpace: "pre" }}>
                    {t.segs.map((seg, j) =>
                      j === 0 ? (
                        seg.text
                      ) : (
                        <span key={j} style={{ position: "absolute", left: seg.left, top: 0 }}>
                          {seg.text}
                        </span>
                      ),
                    )}
                  </p>
                );
              }
              return (
                <p key={i} style={css}>
                  {l}
                </p>
              );
            })}
          </div>
        )}

        {frame}
        {fadingFrame !== null && (
          <div
            className="absolute inset-0"
            style={{ animation: `psSlideFadeOut ${transitionMs}ms linear forwards` }}
          >
            {fadingFrame}
          </div>
        )}
        {alert && (
          /* OpenSong DrawAlert: text inside a box inset Border*3 horizontally /
           * Border*7 vertically, positioned by alert @align/@valign, font
           * scaled size * width/500. The alert's fill draws a band behind the
           * text only. Drawn over every mode, frozen included. */
          (() => {
            const a = style?.alert;
            // OpenSong DrawAlert box insets are multiples of CalcBorderSize.
            const border = a ? Math.max(borderRadiusPx(a, DESIGN_W / 500 / ZOOM), 1) : 10;
            // Row flex: main axis = horizontal (alert @align), cross = vertical (@valign).
            const justify = a?.align === "right" ? "flex-end" : a?.align === "center" ? "center" : "flex-start";
            const align = a?.valign === "bottom" ? "flex-end" : a?.valign === "middle" ? "center" : "flex-start";
            return (
              <div
                className="absolute flex"
                style={{
                  left: border * 3,
                  right: border * 3,
                  top: border,
                  bottom: border * 7,
                  justifyContent: justify,
                  alignItems: align,
                }}
              >
                <span
                  style={{
                    ...(a ? textCss(a, DESIGN_W / 500 / ZOOM) : { fontSize: 40 * (DESIGN_W / 500) }),
                    backgroundColor: a?.fill ? a.fillColor : "rgba(245,158,11,0.95)",
                  }}
                >
                  {alert}
                </span>
              </div>
            );
          })()
        )}
        {index !== undefined && total !== undefined && !black && !logo && (
          <div className="absolute right-6 bottom-4 text-2xl" style={{ color: "rgba(160,160,160,0.6)" }}>
            {index + 1}/{total}
          </div>
        )}
      </div>
    </div>
  );
}
