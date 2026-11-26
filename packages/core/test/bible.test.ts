import { describe, expect, it } from "vitest";
import { scriptureSlideGroup } from "../src/application/scripture.js";
import { buildPlan } from "../src/application/presentation/plan.js";
import type { Service } from "../src/domain/services/types.js";
import { citation, clampReference, parseReference, passage } from "../src/domain/bible/types.js";
import { parseOpenSongBible } from "../src/import/bible/opensong.js";
import { apiBibleChapterVerses, apiBibleList, helloAoChapterVerses, helloAoList } from "../src/import/bible/providers.js";
import type { BibleId } from "../src/ids.js";

const OS_XML = `<?xml version="1.0"?>
<bible biblename="King James Version">
  <b n="43" name="John"><c n="3">
    <v n="16">For God so loved the world, that he gave his only begotten Son</v>
    <v n="17">For God sent not his Son into the world to condemn the world</v>
    <v n="18">He that believeth on him is not condemned</v>
  </c></b>
  <b n="19" name="Psalms"><c n="23"><v n="1">The LORD is my shepherd; I shall not want.</v></c></b>
</bible>`;

const ZEF_XML = `<XMLBIBLE biblename="Test">
  <BIBLEBOOK bnumber="1" bname="Genesis"><CHAPTER cnumber="1">
    <VERS vnumber="1">In the beginning God created the heaven and the earth.</VERS>
    <VERS vnumber="2">And the earth was without form, and void.</VERS>
  </CHAPTER></BIBLEBOOK>
</XMLBIBLE>`;

const bible = parseOpenSongBible(OS_XML, "b1" as BibleId);

describe("reference parsing", () => {
  it("parses common reference forms", () => {
    expect(parseReference("John 3:16")).toEqual({ book: 43, chapter: 3, startVerse: 16, endVerse: 16 });
    expect(parseReference("John 3:16-18")).toEqual({ book: 43, chapter: 3, startVerse: 16, endVerse: 18 });
    expect(parseReference("1 Cor 13:4")).toMatchObject({ book: 46, chapter: 13 });
    expect(parseReference("Psalm 23")).toMatchObject({ book: 19, chapter: 23, startVerse: 1 });
    expect(parseReference("Gen 1:1")).toMatchObject({ book: 1 });
    expect(parseReference("Notabook 1:1")).toBeNull();
  });
  it("formats citations", () => {
    expect(citation({ book: 43, chapter: 3, startVerse: 16, endVerse: 16 })).toBe("John 3:16");
    expect(citation({ book: 43, chapter: 3, startVerse: 16, endVerse: 18 })).toBe("John 3:16-18");
  });
});

describe("OpenSong Bible import", () => {
  it("parses books/chapters/verses", () => {
    expect(bible.books.length).toBe(2);
    expect(bible.books[0]!.name).toBe("John");
    expect(passage(bible, { book: 43, chapter: 3, startVerse: 16, endVerse: 17 })).toEqual([
      "For God so loved the world, that he gave his only begotten Son",
      "For God sent not his Son into the world to condemn the world",
    ]);
  });
  it("accepts Zefania XML too", () => {
    const z = parseOpenSongBible(ZEF_XML, "z" as BibleId);
    expect(z.books[0]!.number).toBe(1);
    expect(passage(z, { book: 1, chapter: 1, startVerse: 1, endVerse: 2 })[1]).toContain("without form");
  });
  it("real OpenSong format: n is the book NAME, bnumber the number", () => {
    // <b bnumber="N" n="Name"> — the shape every shipped OpenSong bible uses.
    const xml = `<?xml version="1.0"?>
    <bible biblename="ENGLISHESV">
      <b bnumber="1" n="Genesis"><c n="1">
        <v n="1">In the beginning, God created the heavens and the earth.</v>
      </c></b>
      <b bnumber="43" n="John"><c n="3"><v n="16">For God so loved the world</v></c></b>
    </bible>`;
    const b = parseOpenSongBible(xml, "esv" as BibleId, "ESV.xml");
    expect(b.name).toBe("ESV"); // OpenSong lists the file name, not biblename
    expect(b.books.map((x) => [x.number, x.name])).toEqual([[1, "Genesis"], [43, "John"]]);
    expect(passage(b, { book: 43, chapter: 3, startVerse: 16, endVerse: 16 })).toEqual(["For God so loved the world"]);
  });
  it("OpenSong format without bnumber: number falls back to name/position", () => {
    const xml = `<bible><b n="Genesis"><c n="1"><v n="1">x</v></c></b><b n="Revelation"><c n="22"><v n="21">y</v></c></b></bible>`;
    const b = parseOpenSongBible(xml, "x" as BibleId);
    expect(b.books[0]!.number).toBe(1);
    expect(b.books[1]!.number).toBe(66); // name lookup beats position (2)
    expect(b.books[1]!.name).toBe("Revelation");
  });
  it("clamps out-of-range refs", () => {
    expect(clampReference(bible, { book: 43, chapter: 3, startVerse: 16, endVerse: 99 }))
      .toMatchObject({ endVerse: 18 });
    expect(clampReference(bible, { book: 43, chapter: 99, startVerse: 1, endVerse: 1 })).toBeNull();
  });
});

describe("provider normalizers", () => {
  it("API.Bible list + chapter html", () => {
    expect(apiBibleList({ data: [{ id: "de4e12af7f28f599-01", name: "KJV", abbreviation: "KJV" }] })[0]).toMatchObject({ id: "de4e12af7f28f599-01" });
    const html = `<p class="p"><span data-number="1" class="v">1</span><span class="wj">In the beginning</span> was the Word. <span data-number="2" class="v">2</span>And the Word was with God.</p>`;
    const verses = apiBibleChapterVerses(html);
    expect(verses[0]).toContain("In the beginning");
    expect(verses[1]).toContain("with God");
  });
  it("HelloAO list + chapter", () => {
    expect(helloAoList({ translations: [{ id: "eng_kjv", englishName: "King James", shortName: "KJV" }] })[0]!.abbreviation).toBe("KJV");
    const verses = helloAoChapterVerses({ chapter: { number: 1, content: [
      { type: "verse", number: 1, content: ["In the beginning was the Word."] },
      { type: "heading", content: ["ignored"] },
      { type: "verse", number: 2, content: ["And the Word was with God."] },
    ] } });
    expect(verses).toHaveLength(2);
    expect(verses[1]).toContain("with God");
  });
});

describe("scripture slides", () => {
  it("groups verses with numbers and copyright", () => {
    const withCopy = { ...bible, copyright: "Public Domain" };
    const g = scriptureSlideGroup(withCopy, [{ book: 43, chapter: 3, startVerse: 16, endVerse: 18 }], { maxVersesPerSlide: 2 });
    expect(g.title).toBe("John 3:16-18 (Bible)");
    expect(g.slides.length).toBe(2);
    expect(g.slides[0]!.body).toContain("16. For God so loved");
    expect(g.slides[1]!.body).toContain("Public Domain");
  });
});

describe("media slides in the plan", () => {
  it("media items expand config.assetKeys into media slides", () => {
    const service = {
      id: "svc", revision: { id: "r", parentId: null, origin: "test", createdAt: "" },
      name: "s", date: null, description: null,
      items: [{
        id: "m1", kind: "media", songId: null, arrangementId: null, mediaAssetId: null,
        title: "Loop", subtitle: null, notes: null, slides: [], loopSeconds: 0,
        config: { assetKeys: ["media/aaa.mp4", "media/bbb.png"] },
      }],
    } as unknown as Service;
    const plan = buildPlan(service, new Map());
    expect(plan.slides).toHaveLength(4); // blank + 2 media + trailing blank
    expect(plan.slides[1]!.mediaKey).toBe("media/aaa.mp4");
    expect(plan.slides[2]!.mediaKey).toBe("media/bbb.png");
  });
});
