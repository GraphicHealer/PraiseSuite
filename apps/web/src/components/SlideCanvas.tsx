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
import type { SlideStyle, TextStyle } from "../slide-types";

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

function textCss(s: TextStyle, zoom = 1): CSSProperties {
  const t = s.borderThickness * ZOOM;
  return {
    fontFamily: fontStack(s.font),
    fontSize: s.size * zoom * ZOOM,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textDecoration: s.underline ? "underline" : "none",
    color: s.color,
    textAlign: s.align,
    textShadow: [
      s.border
        ? `-${t}px -${t}px 0 ${s.borderColor}, ${t}px -${t}px 0 ${s.borderColor}, -${t}px ${t}px 0 ${s.borderColor}, ${t}px ${t}px 0 ${s.borderColor}`
        : "",
      s.shadow ? `0 ${t * 2}px ${t * 3}px ${s.shadowColor}` : "",
    ]
      .filter(Boolean)
      .join(", ") || "none",
  };
}

/** OpenSong FontFaceHeight = TextHeight + 2·border + shadow — extra leading for decorations. */
function lineLeading(s: TextStyle, zoom = 1): number {
  const t = s.borderThickness * ZOOM * zoom;
  return (s.border ? 2 * t : 0) + (s.shadow ? t : 0);
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
  const [bodyZoom, setBodyZoom] = useState(1);

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

  // BodyScale: measure the text at zoom 1 and shrink until it fits.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || !style || !style.body.autoScale) {
      setBodyZoom(1);
      return;
    }
    const z = Math.min(
      1,
      availH / Math.max(1, el.scrollHeight),
      availW / Math.max(1, el.scrollWidth),
    );
    setBodyZoom(z);
  }, [lines, style, availW, availH]);

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
        style={{ justifyContent: justify, alignItems: align, padding: margins(style.body) }}
      >
        <div className="max-w-full" style={{ display: "flex", flexDirection: "column" }}>
          {lines.map((l, i) => (
            <p key={i} style={{ ...textCss(bodyStyle!, bodyZoom), lineHeight: 1.2, margin: 0, marginBottom: lineLeading(bodyStyle!, bodyZoom) }}>
              {l}
            </p>
          ))}
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
            // OpenSong background/@image_fit (cover|contain|fill|center).
            <img
              src={bg}
              alt=""
              className={`absolute inset-0 h-full w-full ${
                style?.backgroundFit === "contain" ? "object-contain" : style?.backgroundFit === "fill" ? "object-fill" : "object-cover"
              }`}
              style={style?.backgroundFit === "center" ? { width: "auto", height: "auto", top: "50%", left: "50%", transform: "translate(-50%,-50%)" } : undefined}
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
  useEffect(() => {
    if (index === prevIndexRef.current) return;
    prevIndexRef.current = index;
    if (transitionMs > 0 && prevFrameRef.current !== null) {
      setFadingFrame(prevFrameRef.current);
      const t = setTimeout(() => setFadingFrame(null), transitionMs);
      return () => clearTimeout(t);
    }
  }, [index, transitionMs]);
  prevFrameRef.current = frame;

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
            {lines.map((l, i) => (
              <p key={i} style={{ ...textCss(bodyStyle!), lineHeight: 1.2, margin: 0, marginBottom: lineLeading(bodyStyle!), whiteSpace: "pre-wrap" }}>
                {l}
              </p>
            ))}
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
            const border = (a?.borderThickness ?? 2) * ((a?.size ?? 40) * (DESIGN_W / 500)) / 40 || 10;
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
