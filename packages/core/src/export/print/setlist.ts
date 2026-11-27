import type { Service } from "../../domain/services/types.js";
import type { LyricLine, SongSection } from "../../domain/songs/types.js";
import type { SongSectionId } from "../../ids.js";
import type { TextStyle } from "../../domain/styles/types.js";
import { lyricsSheetPartsHtml } from "./chord-sheet.js";

/** OpenSong sets_mode/items/<type>/@caption appended to each item name. */
const KIND_CAPTIONS: Record<string, string> = {
  song: "(song)",
  scripture: "(scripture)",
  custom: "(custom)",
  "custom-slides": "(custom)",
  announcement: "(custom)",
  image: "(image)",
  media: "(image)",
  external: "(external)",
  style: "(style)",
};

function line(text: string): LyricLine {
  return {
    // OpenSong SetListReport prefixes every non-empty body line with " ".
    text,
    chords: [],
    breakBefore: "none",
    prefix: text.length > 0 ? " " : null,
    kind: "lyric",
    lang: null,
  };
}

function directive(text: string): LyricLine {
  return { text, chords: [], breakBefore: "none", prefix: null, kind: "directive", lang: null };
}

/**
 * Service -> printable set list. OpenSong SetListReport builds a synthetic
 * song — title "<name> Order of Service", author "Printed <LongDate>" —
 * with one `[V<name> (<kind>)]` section per item and prints it through the
 * lead-sheet engine; scripture/custom items include their slide bodies.
 */
export function setListHtml(service: Service, roles: Record<string, TextStyle> = {}): string {
  const sections: SongSection[] = [];
  for (const item of service.items) {
    const ot = typeof item.config["openSongType"] === "string" ? item.config["openSongType"] : item.kind;
    const caption = `${item.title} ${KIND_CAPTIONS[ot] ?? `(${ot})`}`;
    if (caption.startsWith("--") || item.config["print"] === "false") continue;
    const lines: LyricLine[] = [];
    if (ot.includes("scripture") || ot.includes("custom")) {
      item.slides.forEach((slide, si) => {
        for (const raw of slide.body.trim().split("\n")) lines.push(line(raw));
        if (si > 0) lines.push(directive("-__"));
      });
    }
    sections.push({
      id: `setlist-${sections.length}` as SongSectionId,
      type: "verse",
      label: `V${caption}`,
      lines,
      options: {},
    });
  }
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return lyricsSheetPartsHtml(
    `${service.name} Order of Service`,
    `Printed ${date}`,
    sections,
    [],
    { roles },
    `${service.name} — Order of Service`,
  );
}
