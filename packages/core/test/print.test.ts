import { describe, expect, it } from "vitest";
import {
  chordSheetHtml,
  lyricsSheetHtml,
  setListHtml,
  songbookHtml,
  parseChord,
  parsePrintConfig,
  parseOpenSongLyrics,
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
    aka: null, keyLine: null, theme: "Worship", secondaryTheme: null,
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
    background: null, notes: null,
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

  it("places chords at slice boundaries in the chord row", () => {
    const chordRow = html.split("\n").find((l) => l.includes('class="ch"'))!;
    expect(chordRow).toContain(">G<");
    expect(chordRow).toContain(">C<");
    expect(chordRow).toContain(">D<");
    expect(chordRow.indexOf(">G<")).toBeLessThan(chordRow.indexOf(">C<"));
    expect(chordRow.indexOf(">C<")).toBeLessThan(chordRow.indexOf(">D<"));
  });

  it("draws a continuation hyphen where a word splits at a chord boundary", () => {
    // chord D at offset 25 lands inside "fort_re__ss" -> whole word pulls into
    // the last cell with a left shift and a preceding ‑
    expect(html).toContain("&#8208;fortress");
    expect(html).toContain("margin-left:-3ch");
  });

  it("emits a capo fingering row from the arrangement capo", () => {
    expect(html).toContain("Capo 3");
    const capoRow = html.split("\n").find((l) => l.includes('class="capo"'))!;
    expect(capoRow).toContain(">E<"); // G capo 3 -> E
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
