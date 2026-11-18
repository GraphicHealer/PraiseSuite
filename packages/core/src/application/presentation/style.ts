import type {
  SlideStyle,
  SlideStyleOverride,
  TextStyle,
} from "../../domain/styles/types.js";

function mergeText(base: TextStyle, over?: Partial<TextStyle>): TextStyle {
  return over ? { ...base, ...over } : base;
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
    };
  }
  return out;
}
