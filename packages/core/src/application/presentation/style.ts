import type {
  SlideStyle,
  SlideStyleOverride,
  TextStyle,
} from "../../domain/styles/types.js";

function mergeText(base: TextStyle, over?: Partial<TextStyle>): TextStyle {
  if (!over) return base;
  // borderThickness is the global ThicknessFactor (style/@thickness), not a
  // per-font attribute — never let an override font clobber it.
  const rest = { ...over };
  delete rest.borderThickness;
  return { ...base, ...rest };
}

/**
 * Style chain: global default -> per-item override -> per-slide override
 * (OpenSong allows group/slide-level style settings).
 */
export function resolveSlideStyle(
  global: SlideStyle,
  ...overrides: (SlideStyleOverride | undefined | null)[]
): SlideStyle {
  let out = { ...global, title: { ...global.title }, body: { ...global.body }, subtitle: { ...global.subtitle } };
  for (const o of overrides) {
    if (!o) continue;
    out = {
      ...out,
      title: mergeText(out.title, o.title),
      body: mergeText(out.body, o.body),
      subtitle: mergeText(out.subtitle, o.subtitle),
      ...(o.backgroundColor !== undefined ? { backgroundColor: o.backgroundColor } : {}),
      ...(o.backgroundKey !== undefined ? { backgroundKey: o.backgroundKey } : {}),
      ...(o.margin !== undefined ? { margin: o.margin } : {}),
      ...(o.descriptiveSubtitles !== undefined ? { descriptiveSubtitles: o.descriptiveSubtitles } : {}),
      ...(o.highlightChorus !== undefined ? { highlightChorus: o.highlightChorus } : {}),
      ...(o.songSubtitle !== undefined ? { songSubtitle: o.songSubtitle } : {}),
      ...(o.backgroundFit !== undefined ? { backgroundFit: o.backgroundFit } : {}),
      ...(o.backgroundStripFooter !== undefined ? { backgroundStripFooter: o.backgroundStripFooter } : {}),
      ...(o.backgroundPosX !== undefined ? { backgroundPosX: o.backgroundPosX } : {}),
      ...(o.backgroundPosY !== undefined ? { backgroundPosY: o.backgroundPosY } : {}),
      ...(o.bodyTabs !== undefined ? { bodyTabs: o.bodyTabs } : {}),
    };
  }
  return out;
}
