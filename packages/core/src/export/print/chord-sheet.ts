import type { Song, SongSection } from "../../domain/songs/types.js";
import { capoFingering, transposeChord } from "../../domain/chords/transpose.js";
import { parseChord } from "../../domain/chords/parse.js";
import { esc, printPage, roleCss } from "./layout.js";
import type { PrintConfig } from "../../import/opensong/settings.js";
import { DEFAULT_PRINT_CONFIG } from "../../import/opensong/settings.js";

export interface SheetOptions {
  /** Semitones to transpose chord rows by (musician transpose). */
  transpose?: number | undefined;
  /** Capo fret — adds a capo-fingering chord row per line (capo_chords role). */
  capo?: number | undefined;
  /** Full print config (imported PrintSettings); defaults = OpenSong defaults. */
  print?: PrintConfig | undefined;
  /** @deprecated prefer `print.roles` */
  roles?: PrintConfig["roles"] | undefined;
}

const isLetter = (ch: string | undefined): boolean => ch !== undefined && /\p{L}/u.test(ch);

/** OpenSong slice display rule: strip "_", squeeze spaces, left-trim. */
const clean = (t: string): string => t.replace(/_/g, "").replace(/ {2,}/g, " ").replace(/^ +/, "");

interface WrittenLine { text: string; chords: { offset: number; display: string }[]; prefix: string; lang: 1 | 2 | null }
type Item =
  | { type: "line"; wl: WrittenLine }
  | { type: "blank" }                    // slide separator -> vertical gap
  | { type: "comment"; text: string }
  | { type: "directive"; text: string };

/** Ordered stream: "|" pieces merged into one written line, comments/directives inline. */
function sectionItems(section: SongSection): Item[] {
  const out: Item[] = [];
  let pending: WrittenLine | null = null;
  const flush = () => { if (pending) { out.push({ type: "line", wl: pending }); pending = null; } };
  for (const line of section.lines) {
    if (line.kind === "comment") { flush(); if (!line.text.startsWith(";")) out.push({ type: "comment", text: line.text }); continue; }
    if (line.kind === "directive") { flush(); if (line.text !== "") out.push({ type: "directive", text: line.text }); continue; }
    if (line.kind !== "lyric") continue;
    if (line.breakBefore === "slide" && pending) { flush(); out.push({ type: "blank" }); }
    if (line.breakBefore === "inline" && pending) {
      const base = pending.text.length + 1; // "|" prints as a space
      pending.text += " " + line.text;
      pending.chords.push(...line.chords.map((c) => ({ offset: base + c.offset, display: c.chord.display })));
      continue;
    }
    flush();
    pending = { text: line.text, chords: line.chords.map((c) => ({ offset: c.offset, display: c.chord.display })), prefix: line.prefix ?? " ", lang: line.lang };
  }
  flush();
  return out;
}

const HEADING_NAMES: Record<string, string> = { V: "Verse", P: "Pre-chorus", C: "Chorus", B: "Bridge", T: "Tag" };

/** [V1] -> "Verse 1"; [C] -> "Chorus"; long labels pass through (SongML heading rule). */
function headingName(label: string): string {
  const letter = label.charAt(0).toUpperCase();
  const name = HEADING_NAMES[letter];
  if (name === undefined || label.length > 2) return label;
  return label.length > 1 ? `${name} ${label.slice(1)}` : name;
}

interface Cell { text: string; /** pad-left 1em (blankUnderChord) */ indent?: boolean; /** chars this cell starts left of its column (offsetC pull-back) */ shift?: number; }

/**
 * Slice a lyric line at chord boundaries (SongML Draw_ChordLyricLine).
 * When a chord lands mid-word, the whole word moves into the next cell,
 * which is then drawn starting `shift` chars left of its column.
 */
function lyricCells(text: string, bounds: number[]): Cell[] {
  const cells: Cell[] = [];
  let start = 0;
  for (let i = 0; i <= bounds.length; i++) {
    const b = i < bounds.length ? bounds[i]! : text.length;
    let end = b;
    if (b < text.length && isLetter(text[b - 1]) && isLetter(text[b])) {
      // mid-word boundary: walk back past trailing "_" then to the word start
      let cp = b - 1;
      while (cp > start && text[cp - 1] === "_") cp--;
      while (cp > start && text[cp - 1] !== " " && text[cp - 1] !== "_") cp--;
      end = cp;
    }
    const raw = text.slice(start, end);
    const colStart = i === 0 ? 0 : bounds[i - 1]!;
    cells.push({
      text: clean(raw),
      indent: raw.startsWith(" ") || raw.startsWith("_"),
      shift: Math.max(0, colStart - start),
    });
    start = end;
  }
  return cells;
}

/** True when a dash should join cell i to i+1 (word split at a chord boundary). */
function needsDash(text: string, boundary: number): boolean {
  if (boundary <= 0 || boundary >= text.length) return false;
  return text[boundary - 1] === "_" || (isLetter(text[boundary - 1]) && isLetter(text[boundary]));
}

/** One line-group (.chord + lyric row) -> table rows in the slice-column model. */
function groupHtml(wl: WrittenLine, cfg: PrintConfig, tr: number, capo: number, lang2: boolean, chorus: boolean): string {
  const roles = cfg.roles;
  const bounds = [...new Set(wl.chords.map((c) => c.offset).filter((o) => o > 0))].sort((a, b) => a - b);
  const chordAt = new Map(wl.chords.map((c) => [c.offset, c.display]));
  const mapTr = (d: string) => (tr !== 0 ? transposeChord(parseChord(d), tr, {}).display : d);
  const mapCapo = (d: string) => capoFingering(parseChord(mapTr(d)), capo).display;

  const lyricSpace = cfg.spacing["lyrics"] ?? { before: 0, after: 0 };
  const l2Space = cfg.spacing["lyrics_language2"] ?? lyricSpace;
  const sp = lang2 ? l2Space : lyricSpace;
  const chordSpace = cfg.spacing["chords"] ?? { before: 0, after: 0 };
  const capoSpace = cfg.spacing["capo"] ?? { before: 0, after: 0 };

  const cells = lyricCells(wl.text, bounds);
  const hasChords = wl.chords.length > 0;
  const nRows = 1 + (hasChords ? 1 : 0) + (hasChords && capo > 0 ? 1 : 0);
  const rows: string[] = [];
  const prefixCell =
    wl.prefix === " " ? "" : `<td rowspan="${nRows}" class="pfx" style="${roleCss(roles["lyrics"])};vertical-align:middle">${esc(wl.prefix)}</td>`;

  const chordRow = (role: import("../../domain/styles/types.js").TextStyle | undefined, sp2: { before: number; after: number }, cls: string, map: (d: string) => string) =>
    `<tr class="${cls}"><td></td>` +
    cells
      .map((_, i) => {
        const d = chordAt.get(i === 0 ? 0 : bounds[i - 1]!);
        return `<td style="${roleCss(role)};padding:${sp2.before}pt 1em ${sp2.after}pt 0">${d ? esc(map(d)) : ""}</td>`;
      })
      .join("") +
    `</tr>`;

  if (hasChords && capo > 0) rows.push(chordRow(roles["capo_chords"], capoSpace, "capo", mapCapo));
  if (hasChords) rows.push(chordRow(roles["chords"], chordSpace, "ch", mapTr));
  rows.push(
    `<tr class="ly">${prefixCell}` +
      cells
        .map((c, i) => {
          const boundary = i === 0 ? 0 : bounds[i - 1]!;
          let t = esc(c.text);
          if (c.text !== "" && needsDash(wl.text, boundary)) t = `&#8208;` + t; // ‑ continuation hyphen
          let inner = t;
          if (c.shift) inner = `<span style="margin-left:-${c.shift}ch;display:inline-block">${inner}</span>`;
          if (c.indent) inner = `<span style="margin-left:1em">${inner}</span>`;
          return `<td style="${roleCss(roles[lang2 ? "lyrics_language2" : "lyrics"])};padding:${sp.before}pt 0 ${sp.after}pt 0">${inner}</td>`;
        })
        .join("") +
    `</tr>`,
  );
  return `<table class="grp"${chorus ? ` data-chorus="1"` : ""} style="border-collapse:collapse">${rows.join("")}</table>`;
}

/**
 * Song -> printable chord sheet (OpenSong LeadSheetReport/SongML.Draw model):
 * proportional fonts, slice columns at chord positions, capo row, syllable
 * dashes, heading names/boxes, hidden `;;` comments, `;` comment lines,
 * `-__` rule, `-!!` page break, `---` column break, verse prefixes.
 */
export function chordSheetHtml(song: Song, opts: SheetOptions = {}): string {
  const cfg = opts.print ?? { ...DEFAULT_PRINT_CONFIG, roles: opts.roles ?? {} };
  const roles = cfg.roles;
  const tr = opts.transpose ?? 0;
  const capo = opts.capo ?? song.arrangements[0]?.capo ?? 0;
  const secSpace = cfg.spacing["sections"] ?? { before: 0, after: 0 };

  const parts: string[] = [];
  const title = cfg.capsSongTitle ? song.title.toUpperCase() : song.title;
  parts.push(
    `<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:${cfg.borderThickness}px solid #888;padding-bottom:2pt">` +
      `<span style="${roleCss(roles["title"])}">${esc(title)}</span>` +
      `<span style="${roleCss(roles["author"])}">${esc(song.authors.join("; "))}</span>` +
    `</div>`,
  );
  const meta: string[] = [];
  if (song.defaultKey) meta.push(`Key: ${esc(song.defaultKey)}`);
  if (capo > 0) meta.push(`Capo ${capo}`);
  if (song.tempo) meta.push(`Tempo: ${esc(song.tempo)}`);
  if (song.timeSignature) meta.push(song.timeSignature);
  if (meta.length) parts.push(`<div style="${roleCss(roles["capo_chords"])};margin-top:2pt">${meta.join(" - ")}</div>`);

  const hasColumnBreak = song.sections.some((s) => s.lines.some((l) => l.kind === "directive" && l.text === "--"));
  if (hasColumnBreak) parts.push(`<div style="columns:2;column-gap:2em">`);

  const lyricSize = roles["lyrics"]?.size ?? 12;
  for (const section of song.sections) {
    const chorus = section.label.charAt(0).toUpperCase() === "C" && cfg.highlightChorus;
    const bilingual = section.options["L"] !== undefined;
    parts.push(`<div class="sec" style="margin-top:${secSpace.before + 6}pt">`);
    const head = esc(headingName(section.label));
    parts.push(
      cfg.headerAdornment
        ? `<div style="break-inside:avoid;margin-bottom:${secSpace.after}pt"><span style="${roleCss(roles["heading"])};border:${cfg.borderThickness}px solid #888;border-radius:1em;padding:0 6pt;display:inline-block">${head}</span></div>`
        : `<div style="${roleCss(roles["heading"])};margin-bottom:${secSpace.after}pt">${head}</div>`,
    );

    let rowIdx = 0;
    for (const item of sectionItems(section)) {
      if (item.type === "line") {
        const lang2 = bilingual ? rowIdx % 2 === 1 : item.wl.lang === 2;
        parts.push(`<div style="break-inside:avoid">${groupHtml(item.wl, cfg, tr, capo, lang2, chorus)}</div>`);
        rowIdx++;
      } else if (item.type === "blank") {
        parts.push(`<div style="height:${Math.round(lyricSize * 1.2)}pt"></div>`);
      } else if (item.type === "comment") {
        parts.push(`<div style="${roleCss(roles["copyright"])}">${esc(item.text)}</div>`);
      } else {
        if (item.text === "-!!" || item.text === "!!") parts.push(`<div style="break-before:page"></div>`);
        else if (item.text === "--" || item.text === "---") parts.push(`<div style="break-before:column"></div>`);
        else if (item.text.startsWith("__") || item.text.startsWith("-__")) parts.push(`<hr style="border:none;border-top:${cfg.borderThickness}px solid #999;margin:4pt 0">`);
        else parts.push(`<div style="${roleCss(roles["lyrics"])}">${esc("-" + item.text)}</div>`);
      }
    }
    parts.push("</div>");
  }
  if (hasColumnBreak) parts.push(`</div>`);

  if (song.copyright) parts.push(`<div style="${roleCss(roles["copyright"])};position:fixed;bottom:0;left:0;right:0">Copyright © ${esc(song.copyright)}</div>`);
  const pageCss = `@page { size: ${cfg.page.width}pt ${cfg.page.height}pt; margin: ${cfg.page.margin}pt; }`;
  return printPage(`${song.title} — chord sheet`, `<style>${pageCss}${chorusCss(cfg)}</style>` + parts.join("\n"));
}

function chorusCss(cfg: PrintConfig): string {
  return cfg.highlightChorus ? `table[data-chorus="1"] .ly td { font-weight: bold; }` : "";
}

/**
 * Lyrics-only sheet: headings + cleaned lyric text (no chord columns).
 */
export function lyricsSheetHtml(song: Song, opts: SheetOptions = {}): string {
  const cfg = opts.print ?? { ...DEFAULT_PRINT_CONFIG, roles: opts.roles ?? {} };
  const roles = cfg.roles;
  const secSpace = cfg.spacing["sections"] ?? { before: 0, after: 0 };
  const parts: string[] = [];
  const title = cfg.capsSongTitle ? song.title.toUpperCase() : song.title;
  parts.push(
    `<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:${cfg.borderThickness}px solid #888;padding-bottom:2pt">` +
      `<span style="${roleCss(roles["title"])}">${esc(title)}</span>` +
      `<span style="${roleCss(roles["author"])}">${esc(song.authors.join("; "))}</span>` +
    `</div>`,
  );
  for (const section of song.sections) {
    const bilingual = section.options["L"] !== undefined;
    const chorus = section.label.charAt(0).toUpperCase() === "C" && cfg.highlightChorus;
    parts.push(`<div class="sec" style="break-inside:avoid;margin-top:${secSpace.before + 6}pt">`);
    parts.push(`<div style="${roleCss(roles["heading"])};margin-bottom:${secSpace.after}pt">${esc(headingName(section.label))}</div>`);
    let rowIdx = 0;
    for (const item of sectionItems(section)) {
      if (item.type === "line") {
        const lang2 = bilingual ? rowIdx % 2 === 1 : item.wl.lang === 2;
        const text = (item.wl.prefix === " " ? "" : item.wl.prefix + " ") + clean(item.wl.text);
        parts.push(`<div style="${roleCss(roles[lang2 ? "lyrics_language2" : "lyrics"])}${chorus ? ";font-weight:bold" : ""}">${esc(text)}</div>`);
        rowIdx++;
      } else if (item.type === "comment") {
        parts.push(`<div style="${roleCss(roles["copyright"])}">${esc(item.text)}</div>`);
      } else if (item.type === "blank") {
        parts.push(`<div style="height:1em"></div>`);
      }
    }
    parts.push("</div>");
  }
  if (song.copyright) parts.push(`<div style="${roleCss(roles["copyright"])};margin-top:14pt;font-size:8pt">Copyright © ${esc(song.copyright)}</div>`);
  const pageCss = `@page { size: ${cfg.page.width}pt ${cfg.page.height}pt; margin: ${cfg.page.margin}pt; }`;
  return printPage(`${song.title} — lyrics`, `<style>${pageCss}</style>` + parts.join("\n"));
}
