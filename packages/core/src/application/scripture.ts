import type { BibleTranslation, ScriptureRef } from "../domain/bible/types.js";
import { citation, clampReference, passage } from "../domain/bible/types.js";

export interface ScriptureSlideGroup {
  /** e.g. "John 3:16-18 (KJV)" */
  title: string;
  /** One body string per slide, verses separated by newlines. */
  slides: { body: string }[];
}

/**
 * Build scripture slides for a service item: verses chunked per slide with
 * verse numbers, reference as the title, and the translation's copyright
 * appended to the last slide (provider license requirement).
 */
export function scriptureSlideGroup(
  bible: BibleTranslation,
  refs: ScriptureRef[],
  opts: { maxVersesPerSlide?: number; showVerseNumbers?: boolean } = {},
): ScriptureSlideGroup {
  const max = Math.max(1, opts.maxVersesPerSlide ?? 4);
  const numbered = opts.showVerseNumbers ?? true;
  const slides: { body: string }[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length > 0) {
      slides.push({ body: pending.join("\n") });
      pending = [];
    }
  };
  const titles: string[] = [];
  for (const ref of refs) {
    const clamped = clampReference(bible, ref);
    if (!clamped) continue;
    titles.push(citation(clamped));
    const verses = passage(bible, clamped);
    verses.forEach((text, i) => {
      pending.push(numbered ? `${clamped.startVerse + i}. ${text}` : text);
      if (pending.length >= max) flush();
    });
  }
  flush();
  if (slides.length === 0) slides.push({ body: "" });
  if (bible.copyright) {
    slides[slides.length - 1]!.body += `\n— ${bible.copyright}`;
  }
  const title = `${titles.join("; ")} (${bible.abbreviation})`;
  return { title, slides };
}
