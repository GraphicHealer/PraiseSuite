import type { Song, SongSection } from "../../domain/songs/types.js";
import { capoFingering, transposeChord } from "../../domain/chords/transpose.js";
import { parseChord } from "../../domain/chords/parse.js";
import { esc, pageCss, printPage, roleCss } from "./layout.js";
import type { PrintConfig } from "../../import/opensong/settings.js";
import { mergePrintConfig } from "../../import/opensong/settings.js";

export interface SheetOptions {
  /** Semitones to transpose chord rows by (musician transpose). */
  transpose?: number | undefined;
  /** Capo fret — adds a capo-fingering chord row per line (capo_chords role). */
  capo?: number | undefined;
  /** Full print config (imported PrintSettings); defaults = OpenSong defaults. */
  print?: PrintConfig | undefined;
  /** Church CCLI license number — footer line, SongML ccli/@number. */
  ccliLicense?: string | undefined;
  /**
   * "fixed" repeats the footer on every printed page (single-song sheet);
   * "inline" drops it at the end of the song block — used when several
   * sheets are concatenated in one document (service "print songs"),
   * where per-song fixed footers would all overlay the same spot.
   */
  footer?: "fixed" | "inline" | undefined;
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
function sectionItems(section: SongSection, hideLang2 = false): Item[] {
  const out: Item[] = [];
  let pending: WrittenLine | null = null;
  const flush = () => { if (pending) { out.push({ type: "line", wl: pending }); pending = null; } };
  for (const line of section.lines) {
    if (hideLang2 && line.lang === 2) continue;
    // Blank source lines become breakBefore on whatever follows — comments
    // and directives honor it too (OpenSong's empty-line gap applies to any
    // next element, so comments don't squish against the previous block).
    const preBreak = line.breakBefore === "slide" || line.breakBefore === "bar";
    if (line.kind === "comment") { flush(); if (preBreak) out.push({ type: "blank" }); if (!line.text.startsWith(";")) out.push({ type: "comment", text: line.text }); continue; }
    if (line.kind === "directive") { flush(); if (preBreak) out.push({ type: "blank" }); if (line.text !== "") out.push({ type: "directive", text: line.text }); continue; }
    // Orphan "." row — standalone chords, no lyric text (blockHtml renders
    // chord rows only for a chorded line with empty text).
    if (line.kind === "chord") {
      flush();
      if (preBreak) out.push({ type: "blank" });
      out.push({ type: "line", wl: { text: "", chords: line.chords.map((c) => ({ offset: c.offset, display: c.chord.display })), prefix: " ", lang: null } });
      continue;
    }
    if (line.kind !== "lyric") continue;
    if ((line.breakBefore === "slide" || line.breakBefore === "bar") && pending) { flush(); out.push({ type: "blank" }); }
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

interface Cell {
  text: string;
  /** pad-left 1em (blankUnderChord) */
  indent?: boolean;
  /** chars this cell starts left of its column (offsetC pull-back) */
  shift?: number;
  /** continuation hyphen in the gap before this cell (SongML dashStart) */
  dash?: boolean;
  /** dash offset from this cell's column, in ch — centered in the gap */
  dashShift?: number;
  /** right-side width the next cell pulls back into — SongML keeps the
   *  truncated fragment's measured slice width in the column, so the pulled
   *  word lands in the gap instead of overlapping this cell's text. */
  pad?: number;
}

/**
 * Slice a lyric line at chord boundaries (SongML Draw_ChordLyricLine).
 * When a chord lands mid-word, the whole word moves into the next cell,
 * which is then drawn starting `shift` chars left of its column.
 *
 * Dash rule (SongML): a continuation hyphen is drawn in the gap when "_" is
 * adjacent to the boundary on either side, OR when the boundary splits a
 * word mid-word but the pull-back couldn't happen (the word stays split).
 * A successful pull-back (shift > 0) keeps the word whole — no dash.
 */
function lyricCells(text: string, bounds: number[]): Cell[] {
  const cells: Cell[] = [];
  let start = 0;
  let prevEnd = 0; // rendered end (chars) of the previous cell's text
  for (let i = 0; i <= bounds.length; i++) {
    const b = i < bounds.length ? bounds[i]! : text.length;
    let end = b;
    if (b < text.length && isLetter(text[b - 1]) && isLetter(text[b])) {
      // mid-word boundary: walk back past trailing "_" then to the word start
      let cp = b - 1;
      while (cp > start && text[cp - 1] === "_") cp--;
      while (cp > start && text[cp - 1] !== " " && text[cp - 1] !== "_") cp--;
      if (cp > start) end = cp; // pull-back only when the word start is inside this slice
    }
    const raw = text.slice(start, end);
    const colStart = i === 0 ? 0 : bounds[i - 1]!;
    const shift = Math.max(0, colStart - start);
    const indent = i > 0 && (raw.startsWith(" ") || raw.startsWith("_"));
    const thisStart = colStart - shift + (indent ? 1 : 0);
    // Dash sits centered in the gap between the previous cell's rendered end
    // and this cell's start ("fa - i - ling"). SongML checks "_" at
    // boundary+offsetC — the pulled-back word start, not the raw boundary —
    // so "an___cient" still hyphenates across the chord gap.
    const leftB = colStart;
    const dashAt = leftB - shift;
    const underAdjacent = dashAt > 0 && dashAt < text.length && (text[dashAt - 1] === "_" || text[dashAt] === "_");
    const midWord = leftB > 0 && leftB < text.length && isLetter(text[leftB - 1]) && isLetter(text[leftB]);
    const dash = i > 0 && (underAdjacent || (midWord && shift === 0));
    // The pulled-back fragment stays in this column's width budget (SongML
    // sliceWidth), so the previous cell reserves `shift` chars of space for
    // the word to be drawn back into.
    if (shift > 0 && cells.length > 0) cells[cells.length - 1]!.pad = shift;
    cells.push({
      text: clean(raw),
      indent,
      shift,
      dash,
      // Dash center at gap midpoint → left edge sits half a dash-width left.
      dashShift: dash ? Math.round(((prevEnd + thisStart) / 2 - 0.5 - colStart) * 2) / 2 : 0,
    });
    prevEnd = thisStart + clean(raw).length;
    start = end;
  }
  return cells;
}

/**
 * One block (.chord line + all lyric lines sharing it) -> a table in the
 * slice-column model. SongML draws the whole group from one chordPos array:
 * every lyric line is cut at the SAME boundaries, so a word under "Bb" in
 * verse 1 lines up with the word under the same column in verses 2-4.
 *
 * Column count = bounds + 1 (the "0" sentinel slice before the first chord).
 * Each line's cells are independent — pull-backs/dashes are per-line.
 *
 * Line prefixes (SongML Draw_LinePrefixes): when any line in the block has a
 * non-space prefix, a prefix column is added (each prefix in its line's font)
 * plus a vertical bar spanning the lyric rows, separated by ~1en before and
 * ~1em after.
 */
function blockHtml(
  lines: WrittenLine[],
  cfg: PrintConfig,
  tr: number,
  capo: number,
  capoPrint: boolean,
  capoSharp: boolean,
  bilingual: boolean,
  chorus: boolean,
): string {
  const roles = cfg.roles;
  const vis = cfg.options;
  const first = lines[0]!;
  const hasChordLine = first.chords.length > 0;
  const bounds = hasChordLine
    ? [...new Set(first.chords.map((c) => c.offset).filter((o) => o > 0))].sort((a, b) => a - b)
    : [];
  const chordAt = new Map(first.chords.map((c) => [c.offset, c.display]));
  const mapTr = (d: string) => (tr !== 0 ? transposeChord(parseChord(d), tr, {}).display : d);
  const mapCapo = (d: string) => capoFingering(parseChord(mapTr(d)), capo, capoSharp).display;

  const hasChords = hasChordLine && vis?.hideChords !== true;
  const showCapo = hasChords && capo > 0 && capoPrint && vis?.hideCapo !== true;
  const hasPrefix = lines.some((l) => l.prefix !== " ");
  const colCount = bounds.length + 1;

  const lyricSpace = cfg.spacing["lyrics"] ?? { before: 0, after: 0 };
  const l2Space = cfg.spacing["lyrics_language2"] ?? lyricSpace;
  const chordSpace = cfg.spacing["chords"] ?? { before: 0, after: 0 };
  const capoSpace = cfg.spacing["capo"] ?? { before: 0, after: 0 };

  const headTds = hasPrefix ? `<td></td><td></td>` : "";
  const chordRow = (
    role: import("../../domain/styles/types.js").TextStyle | undefined,
    sp: { before: number; after: number },
    cls: string,
    map: (d: string) => string,
  ) =>
    `<tr class="${cls}">${headTds}` +
    Array.from({ length: colCount }, (_, i) => {
      const d = chordAt.get(i === 0 ? 0 : bounds[i - 1]!);
      const pl = i === 0 && hasPrefix ? "1em" : "0";
      // trailing 1em = SongML's StringWidth(slice + "M") chord spacing
      return `<td style="${roleCss(role)};padding:${sp.before}pt 1em ${sp.after}pt ${pl}">${d ? esc(map(d)) : ""}</td>`;
    }).join("") +
    `</tr>`;

  const rows: string[] = [];
  if (hasChords) rows.push(chordRow(roles["chords"], chordSpace, "ch", mapTr));
  if (showCapo) rows.push(chordRow(roles["capo_chords"], capoSpace, "capo", mapCapo));

  // A "." line with no lyric text draws chord rows only (no empty lyric row)
  const lyricRows = lines.length === 1 && hasChordLine && first.text === "" ? [] : lines;
  lyricRows.forEach((wl, li) => {
    const lang2 = bilingual ? li % 2 === 1 : wl.lang === 2;
    const sp = lang2 ? l2Space : lyricSpace;
    const role = roles[lang2 ? "lyrics_language2" : "lyrics"];
    const pfxTd = hasPrefix
      ? `<td class="pfx" style="${roleCss(role)};padding-right:0.5em;white-space:nowrap">${wl.prefix === " " ? "" : esc(wl.prefix)}</td>`
      : "";
    const barTd =
      hasPrefix && li === 0
        ? `<td class="bar" rowspan="${lyricRows.length}" style="border-left:1px solid #000"></td>`
        : "";
    const tds = lyricCells(wl.text, bounds)
      .map((c, ci) => {
        let t = esc(c.text);
        // OpenSong draws the continuation hyphen centered in the gap between
        // this word and the previous one ("fa - i - ling") — the lyric text
        // itself stays aligned under its chord column.
        if (c.text !== "" && c.dash) t = `<span style="margin-left:${c.dashShift ?? -1}ch">&#8208;</span>` + t;
        let inner = t;
        if (c.shift) inner = `<span style="margin-left:-${c.shift}ch;display:inline-block">${inner}</span>`;
        if (c.indent) inner = `<span style="margin-left:1em">${inner}</span>`;
        // white-space:pre keeps the slice's own trailing space — it is the
        // visual gap to the next column; a td boundary would otherwise
        // collapse it and mash words together.
        const pad = c.pad ? `padding-right:${c.pad}ch;` : "";
        const pl = ci === 0 && hasPrefix ? "padding-left:1em;" : "";
        return `<td style="${roleCss(role)};padding:${sp.before}pt 0 ${sp.after}pt 0;${pad}${pl}white-space:pre">${inner}</td>`;
      })
      .join("");
    rows.push(`<tr class="ly">${pfxTd}${barTd}${tds}</tr>`);
  });
  return `<table class="grp"${chorus ? ` data-chorus="1"` : ""} style="border-collapse:collapse">${rows.join("")}</table>`;
}

/**
 * Song -> printable chord sheet (OpenSong LeadSheetReport/SongML.Draw model):
 * proportional fonts, slice columns at chord positions, capo row, syllable
 * dashes, heading names/boxes, hidden `;;` comments, `;` comment lines,
 * `-__` rule, `-!!` page break, `---` column break, verse prefixes.
 */
export function chordSheetHtml(song: Song, opts: SheetOptions = {}): string {
  const cfg = mergePrintConfig(opts.print ?? (opts.roles ? { roles: opts.roles } : {}));
  const roles = cfg.roles;
  const tr = opts.transpose ?? 0;
  const arr = song.arrangements[0];
  const capo = opts.capo ?? arr?.capo ?? 0;
  // <capo print>: an explicit opts.capo forces the row on; otherwise the
  // song's flag decides (absent on non-OpenSong songs -> show).
  const capoPrint = opts.capo !== undefined ? opts.capo > 0 : arr?.capoPrint !== false;
  // capo/@sharp spells capo chords with sharps; absent falls back to sharps
  // (OpenSong's default ListIndex 0) — an explicit opts.capo always uses sharps.
  const capoSharp = opts.capo !== undefined ? true : arr?.capoSharp !== false;
  const secSpace = cfg.spacing["sections"] ?? { before: 0, after: 0 };

  const parts: string[] = [];
  const title = cfg.capsSongTitle ? song.title.toUpperCase() : song.title;
  parts.push(
    `<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:${cfg.borderThickness}px solid #888;padding-bottom:2pt">` +
      `<span style="${roleCss(roles["title"])}">${esc(title)}</span>` +
      `<span style="${roleCss(roles["author"])}">${esc(song.authors.join("; "))}</span>` +
    `</div>`,
  );
  // SongML "extra header" line(s), right-aligned in the copyright font:
  //   tempo - time_sig Time - Capo N   then   Presentation: V1 V2 C
  const extra: string[] = [];
  if (song.tempo) extra.push(song.tempo);
  if (song.timeSignature) extra.push(`${song.timeSignature} Time`);
  if (capo > 0 && capoPrint) extra.push(`Capo ${capo}`);
  if (extra.length) {
    parts.push(`<div style="${roleCss(roles["copyright"])};text-align:right">${extra.map(esc).join(" - ")}</div>`);
  }
  const seq = arr?.sequence;
  const vis0 = cfg.options;
  if (vis0?.presentationOrder === true && seq !== undefined && seq.length > 0) {
    const byId0 = new Map(song.sections.map((s) => [s.id as string, s]));
    const tokens = seq
      .map((e) => {
        const lbl = byId0.get(e.sectionId as string)?.label ?? "?";
        return `${lbl}${e.prefix ?? ""}`;
      })
      .join(" ");
    parts.push(`<div style="${roleCss(roles["copyright"])};text-align:right">Presentation: ${esc(tokens)}</div>`);
  }

  const hasColumnBreak = song.sections.some((s) => s.lines.some((l) => l.kind === "directive" && l.text === "--"));
  if (hasColumnBreak) parts.push(`<div style="columns:2;column-gap:2em">`);

  const vis = cfg.options;
  // "Print presentation order": sections in the first arrangement's sequence
  // (with repeats) instead of written order.
  const byId = new Map(song.sections.map((s) => [s.id as string, s]));
  const ordered =
    vis?.presentationOrder === true && seq !== undefined && seq.length > 0
      ? seq.flatMap((e) => {
          const s = byId.get(e.sectionId as string);
          return s ? Array.from({ length: e.repeats }, () => s) : [];
        })
      : song.sections;

  const lyricSize = roles["lyrics"]?.size ?? 12;
  const isDigit = (p: string) => /^[1-9]$/.test(p);
  let firstSec = true;
  for (const section of ordered) {
    // SongML draws a blank source line before a section header as a
    // one-lyric-line gap (skipped only at the top of a column/page).
    if (section.leadingBlank === true && !firstSec) {
      parts.push(`<div style="height:${Math.round(lyricSize * 1.2)}pt"></div>`);
    }
    firstSec = false;
    const chorus = section.label.charAt(0).toUpperCase() === "C" && cfg.highlightChorus;
    const bilingual = section.options["L"] !== undefined;
    parts.push(`<div class="sec" style="margin-top:${secSpace.before}pt">`);
    const head = esc(headingName(section.label));
    if (head !== "") {
      parts.push(
        cfg.headerAdornment
          ? `<div style="break-inside:avoid;margin-bottom:${secSpace.after}pt"><span style="${roleCss(roles["heading"])};border:${cfg.borderThickness}px solid #888;border-radius:1em;padding:0 6pt;display:inline-block">${head}</span></div>`
          : `<div style="${roleCss(roles["heading"])};margin-bottom:${secSpace.after}pt">${head}</div>`,
      );
    }

    const items = sectionItems(section, vis?.hideLang2 === true);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.type === "line") {
        // FindLyricLineCount: a ".chord" line's positions apply to every
        // lyric line it precedes — digit-prefixed runs go together, a
        // space-prefixed line stands alone (or pairs when bilingual).
        const block: WrittenLine[] = [item.wl];
        const chorded = item.wl.chords.length > 0;
        let j = i + 1;
        const nextWl = (): WrittenLine | undefined => {
          const it = items[j];
          return it !== undefined && it.type === "line" ? it.wl : undefined;
        };
        const firstLyric = chorded ? nextWl() : item.wl;
        if (firstLyric !== undefined && isDigit(firstLyric.prefix)) {
          const sameChords = (w: WrittenLine) =>
            w.chords.length === block[0]!.chords.length &&
            w.chords.every((c, k) => c.offset === block[0]!.chords[k]!.offset && c.display === block[0]!.chords[k]!.display);
          while (j < items.length) {
            const w = nextWl();
            // A following line may carry the SAME chord row (numbered-verse
            // blocks share one ".chord" row — SongML FindLyricLineCount) —
            // only different chords start a new group.
            if (w === undefined || !isDigit(w.prefix) || (w.chords.length > 0 && !sameChords(w))) break;
            block.push(w);
            j++;
          }
        } else if (firstLyric !== undefined && firstLyric.prefix === " ") {
          if (chorded) {
            block.push(firstLyric);
            j++;
          }
          const w = nextWl();
          if (bilingual && w !== undefined && w.chords.length === 0 && w.prefix === " ") {
            block.push(w);
            j++;
          }
        }
        parts.push(`<div style="break-inside:avoid">${blockHtml(block, cfg, tr, capo, capoPrint, capoSharp, bilingual, chorus)}</div>`);
        i = j - 1;
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

  // SongML Draw_Footer: the rule always draws, even when no copyright
  // lines exist. Stacked top→bottom: copyright, CCLI song #, CCLI license.
  // "fixed" repeats it on every printed page (OpenSong draws it per page);
  // padding-bottom keeps the last lyric line from sliding underneath.
  const foot: string[] = [];
  if (song.copyright) foot.push(`<div style="${roleCss(roles["copyright"])}">Copyright © ${esc(song.copyright)}</div>`);
  if (song.ccliNumber && song.ccliNumber !== "0000") foot.push(`<div style="${roleCss(roles["copyright"])}">CCLI Song # ${esc(song.ccliNumber)}</div>`);
  if (opts.ccliLicense) foot.push(`<div style="${roleCss(roles["copyright"])}">CCLI License # ${esc(opts.ccliLicense)}</div>`);
  const footPos =
    opts.footer === "inline" ? "" : "position:fixed;bottom:0;left:0;right:0;background:#fff;";
  parts.push(
    `<div class="print-footer" style="${footPos}text-align:center;border-top:1px solid #000;padding-top:2pt">${foot.join("")}</div>`,
  );
  const pageStyle = pageCss(cfg.page);
  // Reserve footer height so the last lyric line never slides underneath.
  const footPad = opts.footer === "inline" ? "" : `body{padding-bottom:${10 + foot.length * 13}pt}`;
  return printPage(`${song.title} — chord sheet`, `<style>${pageStyle}${footPad}${chorusCss(cfg)}</style>` + parts.join("\n"));
}

function chorusCss(cfg: PrintConfig): string {
  // SongML highlight_chorus bolds the lyric text (prefixes stay unbolded).
  return cfg.highlightChorus ? `table[data-chorus="1"] .ly td:not(.pfx) { font-weight: bold; }` : "";
}

/**
 * Lyrics-only sheet: headings + cleaned lyric text (no chord columns).
 */
export function lyricsSheetHtml(song: Song, opts: SheetOptions = {}): string {
  const cfg = mergePrintConfig(opts.print ?? (opts.roles ? { roles: opts.roles } : {}));
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
  let firstSec = true;
  for (const section of song.sections) {
    if (section.leadingBlank === true && !firstSec) {
      parts.push(`<div style="height:1em"></div>`);
    }
    firstSec = false;
    const bilingual = section.options["L"] !== undefined;
    const chorus = section.label.charAt(0).toUpperCase() === "C" && cfg.highlightChorus;
    parts.push(`<div class="sec" style="break-inside:avoid;margin-top:${secSpace.before}pt">`);
    const head = esc(headingName(section.label));
    if (head !== "") {
      parts.push(`<div style="${roleCss(roles["heading"])};margin-bottom:${secSpace.after}pt">${head}</div>`);
    }
    let rowIdx = 0;
    for (const item of sectionItems(section, cfg.options?.hideLang2 === true)) {
      if (item.type === "line") {
        const lang2 = bilingual ? rowIdx % 2 === 1 : item.wl.lang === 2;
        const text = (item.wl.prefix === " " ? "" : item.wl.prefix + " ") + clean(item.wl.text);
        parts.push(`<div style="${roleCss(roles[lang2 ? "lyrics_language2" : "lyrics"])}${chorus ? ";font-weight:bold" : ""}">${esc(text)}</div>`);
        rowIdx++;
      } else if (item.type === "comment") {
        // Musician notes — chord sheets only, hidden on lyric sheets.
      } else if (item.type === "blank") {
        parts.push(`<div style="height:1em"></div>`);
      }
    }
    parts.push("</div>");
  }
  // Same Draw_Footer contract as the chord sheet: rule always, then
  // copyright / CCLI song # / CCLI license stacked above it.
  const foot: string[] = [];
  if (song.copyright) foot.push(`<div style="${roleCss(roles["copyright"])}">Copyright © ${esc(song.copyright)}</div>`);
  if (song.ccliNumber && song.ccliNumber !== "0000") foot.push(`<div style="${roleCss(roles["copyright"])}">CCLI Song # ${esc(song.ccliNumber)}</div>`);
  if (opts.ccliLicense) foot.push(`<div style="${roleCss(roles["copyright"])}">CCLI License # ${esc(opts.ccliLicense)}</div>`);
  const footPos =
    opts.footer === "inline" ? "" : "position:fixed;bottom:0;left:0;right:0;background:#fff;";
  parts.push(
    `<div class="print-footer" style="${footPos}text-align:center;border-top:1px solid #000;padding-top:2pt">${foot.join("")}</div>`,
  );
  const pageStyle = pageCss(cfg.page);
  const footPad = opts.footer === "inline" ? "" : `body{padding-bottom:${10 + foot.length * 13}pt}`;
  return printPage(`${song.title} — lyrics`, `<style>${pageStyle}${footPad}</style>` + parts.join("\n"));
}
