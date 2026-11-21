import { describe, expect, it } from "vitest";
import {
  chordSheetHtml,
  lyricsSheetHtml,
  setListHtml,
  songbookHtml,
  parseChord,
  parsePrintConfig,
  parseOpenSongLyrics,
  applyPrintOverrides,
  mergePrintConfig,
  DEFAULT_PRINT_CONFIG,
  type Service,
  type Song,
} from "../src/index.js";

const REV = { id: "r1", parentId: null, origin: "t", createdAt: "2026-01-01T00:00:00Z" };

function song(): Song {
  return {
    id: "s1" as Song["id"],
    revision: REV as Song["revision"],
    title: "Test Hymn",
    authors: ["Writer One", "Writer Two"],
    copyright: "(c) 2026 PD",
    ccliNumber: "123",
    defaultKey: "G", tempo: "120", timeSignature: "4/4",
    aka: null, keyLine: null, theme: "Worship", secondaryTheme: null, folder: null,
    userFields: { user1: "", user2: "", user3: "" },
    sections: [
      {
        id: "v1" as Song["sections"][0]["id"],
        type: "verse", label: "V1", options: {},
        lines: [
          {
            text: "choo___sing  a mighty fort_re__ss",
            chords: [
              { offset: 0, chord: parseChord("G") },
              { offset: 14, chord: parseChord("C") },
              { offset: 25, chord: parseChord("D") },
            ],
            breakBefore: "none", prefix: " ", kind: "lyric", lang: null,
          },
        ],
      },
    ],
    arrangements: [
      {
        id: "a1" as Song["arrangements"][0]["id"],
        name: "Default", key: null, tempo: null, timeSignature: null,
        capo: 3, notes: null,
        sequence: [
          { id: "as1" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "v1" as Song["sections"][0]["id"], repeats: 1, prefix: null },
        ],
      },
    ],
    background: null,
    backgrounds: null, notes: null,
    hymnNumber: null, presentationRaw: null, linkedSongs: [], styleXml: null, styleBackgroundKey: null, extras: [],
  };
}

describe("chordSheetHtml (SongML slice model)", () => {
  const html = chordSheetHtml(song());

  it("has title, authors and the localized heading name", () => {
    expect(html).toContain("Test Hymn");
    expect(html).toContain("Writer One; Writer Two");
    expect(html).toContain("Verse 1"); // [V1] -> "Verse 1"
  });

  it("renders lyric slices in a column table, underscores removed", () => {
    expect(html).toContain('<table class="grp"');
    expect(html).toContain("choosing");   // "_" stripped in print too
    expect(html).not.toContain("choo___sing");
  });

  it("keeps slice-internal spaces (td boundaries don't mash words)", () => {
    // white-space:pre preserves the slice's trailing space — without it the
    // td boundary collapses the gap and "choosing a mighty" becomes one word.
    const lyRow = html.split("\n").find((l) => l.includes('class="ly"'))!;
    expect(lyRow).toContain("white-space:pre");
    expect(lyRow).toContain("mighty "); // trailing slice space preserved -> gap to next column
  });

  it("places chords at slice boundaries in the chord row", () => {
    const chordRow = html.split("\n").find((l) => l.includes('class="ch"'))!;
    expect(chordRow).toContain(">G<");
    expect(chordRow).toContain(">C<");
    expect(chordRow).toContain(">D<");
    expect(chordRow.indexOf(">G<")).toBeLessThan(chordRow.indexOf(">C<"));
    expect(chordRow.indexOf(">C<")).toBeLessThan(chordRow.indexOf(">D<"));
  });

  it("pulls a mid-word chord's word into its slice — no dash (SongML offsetC)", () => {
    // chord D at offset 25 lands inside "fort|ress" -> the whole word moves
    // into the next cell drawn 3ch left; a successful pull-back draws NO dash
    // (dashes mark words that stay split, or "_" gaps).
    expect(html).toContain("margin-left:-3ch");
    expect(html).toContain(">fortress");
    expect(html).not.toContain("&#8208;fortress");
  });

  it("draws a continuation hyphen when '_' is adjacent to a boundary", () => {
    // "an___cient": chord over "cient" -> "_" adjacent -> dash in the gap.
    const { sections } = parseOpenSongLyrics("[V]\n.G      D\nan___cient foe\n");
    const s = song();
    const h = chordSheetHtml({ ...s, sections: sections.map((x, i) => ({ ...x, id: `u${i}` as Song["sections"][0]["id"] })) });
    expect(h).toContain("&#8208;");
  });

  it("emits a capo fingering row from the arrangement capo", () => {
    expect(html).toContain("Capo 3");
    const capoRow = html.split("\n").find((l) => l.includes('class="capo"'))!;
    expect(capoRow).toContain(">E<"); // G capo 3 -> E
  });

  it("slices every verse line at the shared chord positions (SongML group)", () => {
    // One ".chord" line followed by 4 verse lines: all four rows get cut at
    // the same boundaries so the word under each chord column aligns.
    const { sections } = parseOpenSongLyrics(
      "[V]\n.Bb      F      Eb\n1A mighty fortress is our God\n2Did we in our own strength\n3And though this world with\n4That Word above all\n",
    );
    const s = song();
    const h = chordSheetHtml({ ...s, sections: sections.map((x, i) => ({ ...x, id: `u${i}` as Song["sections"][0]["id"] })) });
    const grp = h.match(/<table class="grp"[\s\S]*?<\/table>/)![0];
    const lyRows = grp.match(/<tr class="ly">[\s\S]*?<\/tr>/g)!;
    expect(lyRows.length).toBe(4);
    // verse 2-4 have no chords of their own — they must still be sliced
    for (const row of lyRows) {
      const tds = row.match(/<td/g)!.length;
      expect(tds).toBeGreaterThan(3); // prefix + bar + 3 slice cells (2 bounds + lead)
    }
    expect(grp).toContain('class="bar" rowspan="4"');
    expect(lyRows[1]).toContain("Did we");
  });

  it("suppresses the capo row when <capo print=\"false\"> was imported", () => {
    const s = song();
    const noPrint = chordSheetHtml({
      ...s,
      arrangements: s.arrangements.map((a) => ({ ...a, capoPrint: false })),
    });
    expect(noPrint).not.toContain('class="capo"');
    expect(noPrint).not.toContain("Capo 3");
  });

  it("transposes the chord row (and the capo row follows)", () => {
    const up = chordSheetHtml(song(), { transpose: 2 });
    const chordRow = up.split("\n").find((l) => l.includes('class="ch"'))!;
    expect(chordRow).toContain(">A<"); // G +2 -> A
  });

  it("uses role fonts and page size from PrintSettings", () => {
    const cfg = parsePrintConfig(`<print_settings>
      <lyrics font="Arial Narrow" size="12" bold="false" italic="false" color="#000000"/>
      <chords font="Times New Roman" size="11" bold="true" italic="false" color="#000080"/>
      <style caps_song_title="true" header_adornment="true" border_thickness="2"/>
      <page width="612" height="792" left="72"/>
      <layout><lyrics space_before="3" space_after="4"/></layout>
    </print_settings>`);
    const h = chordSheetHtml(song(), { print: cfg });
    expect(h).toContain("TEST HYMN");                     // caps_song_title
    expect(h).toContain("size: 612pt 792pt");             // page box
    expect(h).toContain("border-radius:1em");             // header_adornment box
    expect(h).toContain("padding:3pt 0 4pt 0");           // lyrics spacing
    const chordRow = h.split("\n").find((l) => l.includes('class="ch"'))!;
    expect(chordRow).toContain("#000080");                // chords role color
    expect(chordRow).toContain("font-weight:bold");       // chords role weight
  });

  it("prints comments but hides ';;' hidden comments", () => {
    const { sections } = parseOpenSongLyrics("[V]\n.A B\nline\n;visible note\n;;secret note\n");
    const s = song();
    const h = chordSheetHtml({ ...s, sections: sections.map((x, i) => ({ ...x, id: `sec${i}` as Song["sections"][0]["id"] })) });
    expect(h).toContain("visible note");
    expect(h).not.toContain("secret note");
  });

  it("renders -!! page breaks, -__ rules and --- column breaks", () => {
    const { sections } = parseOpenSongLyrics("[V]\nline one\n-__\nline two\n-!!\nline three\n");
    const s = song();
    const h = chordSheetHtml({ ...s, sections: sections.map((x, i) => ({ ...x, id: `sec${i}` as Song["sections"][0]["id"] })) });
    expect(h).toContain("<hr");
    expect(h).toContain("break-before:page");
  });

  it("renders numbered-verse prefixes in a margin column", () => {
    const { sections } = parseOpenSongLyrics("[V]\n.A B\n1 first verse line\n2 second verse line\n");
    const s = song();
    const h = chordSheetHtml({ ...s, sections: sections.map((x, i) => ({ ...x, id: `sec${i}` as Song["sections"][0]["id"] })) });
    expect(h).toContain('class="pfx"');
    expect(h).toContain(">1<");
    expect(h).toContain(">2<");
  });

  it("maps heading labels: C->Chorus, P->Pre-chorus, B->Bridge, T->Tag", () => {
    const { sections } = parseOpenSongLyrics("[C1]\nx\n[P]\ny\n[B2]\nz\n[T]\nw\n");
    const s = song();
    const h = chordSheetHtml({ ...s, sections: sections.map((x, i) => ({ ...x, id: `sec${i}` as Song["sections"][0]["id"] })) });
    expect(h).toContain("Chorus 1");
    expect(h).toContain("Pre-chorus");
    expect(h).toContain("Bridge 2");
    expect(h).toContain("Tag");
  });
});

describe("applyPrintOverrides", () => {
  it("overrides a role's fields via r_<role>_<prop> params", () => {
    const cfg = applyPrintOverrides(DEFAULT_PRINT_CONFIG, {
      r_chords_font: "JetBrains Mono", r_chords_size: "14", r_chords_color: "#ff0000",
      r_chords_bold: "0", r_chords_italic: "1", r_chords_underline: "1",
    });
    expect(cfg.roles["chords"]).toMatchObject({ font: "JetBrains Mono", size: 14, color: "#ff0000", bold: false, italic: true, underline: true });
    expect(cfg.roles["lyrics"]).toBeUndefined(); // untouched
    // other roles are independent — capo keeps its own style
    expect(cfg.roles["capo_chords"]).toBeUndefined();
  });

  it("sets margins — uniform and per-side", () => {
    const cfg = applyPrintOverrides(DEFAULT_PRINT_CONFIG, { margin: "36", marginTop: "48" });
    expect(cfg.page).toMatchObject({ top: 48, right: 36, bottom: 36, left: 36 });
  });

  it("style flags + visibility toggles", () => {
    const cfg = applyPrintOverrides(DEFAULT_PRINT_CONFIG, {
      capsTitle: "0", chorus: "0", adorn: "1", border: "3",
      hideChords: "1", hideCapo: "1", hideLang2: "1", order: "1",
    });
    expect(cfg.capsSongTitle).toBe(false);
    expect(cfg.highlightChorus).toBe(false);
    expect(cfg.headerAdornment).toBe(true);
    expect(cfg.borderThickness).toBe(3);
    expect(cfg.options).toEqual({ hideChords: true, hideCapo: true, hideLang2: true, presentationOrder: true });
  });

  it("landscape swaps the page box", () => {
    const cfg = applyPrintOverrides(DEFAULT_PRINT_CONFIG, { landscape: "1" });
    expect(cfg.page).toMatchObject({ width: 792, height: 612 });
  });

  it("does not mutate the input config", () => {
    const src = { ...DEFAULT_PRINT_CONFIG };
    applyPrintOverrides(src, { r_chords_size: "20" });
    expect(src.roles["chords"]).toBeUndefined();
  });
});

describe("mergePrintConfig", () => {
  it("fills every role from the OpenSong defaults", () => {
    const cfg = mergePrintConfig();
    expect(cfg.roles["chords"]).toMatchObject({ font: "Times New Roman", bold: true, color: "#000080" });
    expect(cfg.roles["lyrics"]).toMatchObject({ font: "Arial Narrow" });
  });

  it("merges stored partial roles field-by-field, not wholesale", () => {
    const cfg = mergePrintConfig({ roles: { chords: { font: "JetBrains Mono" } as never } });
    expect(cfg.roles["chords"]).toMatchObject({ font: "JetBrains Mono", bold: true, color: "#000080", size: 11 });
    expect(cfg.roles["lyrics"]).toMatchObject({ font: "Arial Narrow" }); // defaults survive
  });
});

describe("lyricsSheetHtml", () => {
  const html = lyricsSheetHtml(song());
  it("strips underscores and squeezes spaces", () => {
    expect(html).toContain("choosing a mighty fortress");
    expect(html).not.toContain("choo___sing");
  });
  it("has no chord row", () => {
    expect(html).not.toContain('class="ch"');
  });
});

describe("setListHtml", () => {
  const svc: Service = {
    id: "sv" as Service["id"], revision: REV as Service["revision"],
    name: "Sunday 10am", date: "2026-02-01", description: null,
    items: [
      { id: "i1" as Service["items"][0]["id"], kind: "song", songId: "s1" as Song["id"], arrangementId: null, mediaAssetId: null, title: "Test Hymn", subtitle: null, notes: null, slides: [], loopSeconds: 0, config: {} },
      { id: "i2" as Service["items"][0]["id"], kind: "scripture", songId: null, arrangementId: null, mediaAssetId: null, title: "John 3:16", subtitle: null, notes: null, slides: [], loopSeconds: 0, config: { reference: "John 3:16" } },
    ],
  };
  const html = setListHtml(svc);
  it("lists items in order with details", () => {
    expect(html.indexOf("Test Hymn")).toBeLessThan(html.indexOf("John 3:16"));
    expect(html).toContain("Sunday 10am");
    expect(html).toContain("scripture");
  });
});

describe("songbookHtml", () => {
  it("groups by theme and numbers entries", () => {
    const s = song();
    const html = songbookHtml([s, { ...s, title: "Another", theme: "Praise" }]);
    expect(html.indexOf("Worship")).toBeLessThan(html.indexOf("Test Hymn"));
    expect(html.indexOf("Praise")).toBeLessThan(html.indexOf("Another"));
    expect(html).toContain("1. ");
    expect(html).toContain("2. ");
  });
});
