import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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

/** OpenSong font sizes are points — 96/72 converts to design-space px. */
const PT_PX = 96 / 72;

function textCss(s: TextStyle, zoom = 1): CSSProperties {
  return {
    fontFamily: fontStack(s.font),
    fontSize: s.size * zoom * PT_PX,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textDecoration: s.underline ? "underline" : "none",
    color: s.color,
    textAlign: s.align,
    textShadow: [
      s.border
        ? `-${s.borderThickness}px -${s.borderThickness}px 0 ${s.borderColor}, ${s.borderThickness}px -${s.borderThickness}px 0 ${s.borderColor}, -${s.borderThickness}px ${s.borderThickness}px 0 ${s.borderColor}, ${s.borderThickness}px ${s.borderThickness}px 0 ${s.borderColor}`
        : "",
      s.shadow ? `0 ${s.borderThickness * 2}px ${s.borderThickness * 3}px ${s.shadowColor}` : "",
    ]
      .filter(Boolean)
      .join(", ") || "none",
  };
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
  next,
  alert,
  index,
  total,
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
  next?: { title: string } | null | undefined;
  alert?: string | null | undefined;
  index?: number | undefined;
  total?: number | undefined;
}): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
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

  const margin = style?.margin ?? 0;
  const availW = DESIGN_W - margin * 2;
  const availH = DESIGN_H - margin * 2;

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

  const justify =
    style?.body.valign === "top" ? "flex-start" : style?.body.valign === "bottom" ? "flex-end" : "center";
  const align =
    style?.body.align === "left" ? "flex-start" : style?.body.align === "right" ? "flex-end" : "center";

  const body = style && (
    <div
      className="absolute inset-0 flex flex-col"
      style={{ padding: margin, justifyContent: justify, alignItems: align }}
    >
      {style.title.enabled && (
        <div className="absolute top-0 right-0 left-0" style={{ padding: `40px 80px 0`, ...textCss(style.title) }}>
          {title}
        </div>
      )}
      <div className="max-w-full" style={{ display: "flex", flexDirection: "column", gap: style.body.size * PT_PX * 0.4 * bodyZoom }}>
        {lines.map((l, i) => (
          <p key={i} style={{ ...textCss(style.body, bodyZoom), lineHeight: 1.2, margin: 0 }}>
            {l}
          </p>
        ))}
      </div>
      {style.subtitle.enabled && (
        <div className="absolute right-0 bottom-0 left-0" style={{ padding: `0 80px 40px`, ...textCss(style.subtitle) }}>
          {style.descriptiveSubtitles ? next?.title ?? "" : title.split(" — ")[0]}
        </div>
      )}
    </div>
  );

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
            style={{ width: availW, padding: margin, display: "flex", flexDirection: "column", gap: style.body.size * PT_PX * 0.4 }}
          >
            {lines.map((l, i) => (
              <p key={i} style={{ ...textCss(style.body), lineHeight: 1.2, margin: 0, whiteSpace: "pre-wrap" }}>
                {l}
              </p>
            ))}
          </div>
        )}

        {!black && !white && (
          <>
            {bg && isVideo(backgroundKey ?? "") ? (
              <video key={bg} src={bg} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" />
            ) : bg ? (
              <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ backgroundColor: style?.backgroundColor ?? "#000" }} />
            )}
          </>
        )}
        {white && <div className="absolute inset-0 bg-white" />}
        {mediaKey && !black && !white && !logo && (
          isVideo(mediaKey) ? (
            <video key={mediaKey} src={mediaUrl(mediaKey)} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full bg-black object-contain" />
          ) : (
            <img src={mediaUrl(mediaKey)} alt="" className="absolute inset-0 h-full w-full bg-black object-contain" />
          )
        )}
        {logo && logoKey && !black && !white && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <img src={mediaUrl(logoKey)} alt="logo" style={{ maxHeight: "60%", maxWidth: "60%" }} />
          </div>
        )}
        {!black && !white && !hidden && !logo && !(backgroundAsText && bg) && body}
        {alert && (
          <div
            className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-xl text-black shadow-2xl"
            style={{
              padding: "32px 64px",
              backgroundColor: style?.alert.fill ? style.alert.fillColor : "rgba(245,158,11,0.95)",
              ...(style ? textCss(style.alert) : { fontSize: 48 }),
            }}
          >
            {alert}
          </div>
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
