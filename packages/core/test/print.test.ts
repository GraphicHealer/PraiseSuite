import { describe, expect, it } from "vitest";
import {
  chordSheetHtml,
  lyricsSheetHtml,
  setListHtml,
  songbookHtml,
  parseChord,
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

describe("chordSheetHtml", () => {
  const html = chordSheetHtml(song());

  it("has title, authors, section heading and lyrics", () => {
    expect(html).toContain("Test Hymn");
    expect(html).toContain("Writer One; Writer Two");
    expect(html).toContain(">V1<");
    expect(html).toContain("choo___sing");
  });

  it("keeps _ padding on chord sheets and places chords at offsets", () => {
    expect(html).toContain("choo___sing  a mighty fort_re__ss");
    const chordLine = html.split("\n").find((l) => l.includes("ps-line") && l.includes("bold"));
    expect(chordLine).toBeTruthy();
    // G at col1, C at offset 15, D at offset 26 in the written line
    expect(chordLine).toMatch(/>\s*G\s+C\s+D/);
  });

  it("shows capo fingering row from arrangement capo", () => {
    expect(html).toContain("Capo 3");
    // capo 3 fingering of G -> E; capo row is the non-bold monospace row
    const capoRow = html.split("\n").find((l) => l.includes("ps-line") && l.includes("monospace") && !l.includes("bold"));
    expect(capoRow).toMatch(/>\s*E/);
  });

  it("transposes chord rows", () => {
    const up = chordSheetHtml(song(), { transpose: 2 });
    const chordLine = up.split("\n").find((l) => l.includes("ps-line") && l.includes("bold"));
    expect(chordLine).toMatch(/>\s*A/); // G +2 -> A
  });
});

describe("lyricsSheetHtml", () => {
  const html = lyricsSheetHtml(song());
  it("strips underscores and squeezes spaces", () => {
    expect(html).toContain("choosing a mighty fortress");
    expect(html).not.toContain("choo___sing");
  });
  it("has no chord row", () => {
    expect(html).not.toContain("font-weight:bold\">G");
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
