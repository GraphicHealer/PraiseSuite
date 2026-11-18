import type { Song } from "../../domain/songs/types.js";
import type { TextStyle } from "../../domain/styles/types.js";
import { esc, printPage, roleCss } from "./layout.js";

/**
 * Song library -> printable songbook/TOC, grouped by theme then title
 * (OpenSong's songbook report layout).
 */
export function songbookHtml(songs: Pick<Song, "title" | "authors" | "theme">[], roles: Record<string, TextStyle> = {}): string {
  const groups = new Map<string, typeof songs>();
  for (const s of songs) {
    const key = s.theme ?? "(untagged)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const parts: string[] = [];
  parts.push(`<h1 style="${roleCss(roles["title"])};margin-bottom:8pt">Songbook</h1>`);
  let n = 0;
  for (const theme of [...groups.keys()].sort()) {
    parts.push(`<div class="ps-sec"><div style="${roleCss(roles["heading"])};font-weight:bold;border-bottom:1px solid #bbb;padding-bottom:2pt">${esc(theme)}</div>`);
    for (const s of [...groups.get(theme)!].sort((a, b) => a.title.localeCompare(b.title))) {
      n++;
      const auth = s.authors.length ? ` <span style="color:#777">— ${esc(s.authors.join("; "))}</span>` : "";
      parts.push(
        `<div class="ps-line" style="${roleCss(roles["lyrics"])};font-family:sans-serif">${n}. ${esc(s.title)}${auth}</div>`,
      );
    }
    parts.push("</div>");
  }
  return printPage(`Songbook (${songs.length} songs)`, parts.join("\n"));
}
