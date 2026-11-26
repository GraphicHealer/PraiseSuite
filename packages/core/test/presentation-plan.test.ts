import { describe, expect, it } from "vitest";
import {
  buildPlan,
  indexOfPosition,
  navigate,
  parseOpenSongLyrics,
  positionOfSlide,
  type Service,
  type Song,
} from "../src/index.js";

const REV = { id: "r1", parentId: null, origin: "t", createdAt: "2026-01-01T00:00:00Z" };

function song(id: string): Song {
  return {
    id: id as Song["id"],
    revision: REV as Song["revision"],
    title: "Test Song",
    authors: [],
    copyright: null, ccliNumber: null, defaultKey: null, tempo: null, timeSignature: null,
    aka: null, keyLine: null, theme: null, secondaryTheme: null, folder: null, fileName: null,
    userFields: { user1: "", user2: "", user3: "" },
    sections: [
      {
        id: "s1" as Song["sections"][0]["id"],
        type: "verse", label: "V1", options: {},
        lines: [
          { text: "line1", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: null },
          { text: "line2", chords: [], breakBefore: "bar", prefix: null, kind: "lyric", lang: null },
        ],
      },
      {
        id: "s2" as Song["sections"][0]["id"],
        type: "chorus", label: "C", options: {},
        lines: [{ text: "chorus", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: null }],
      },
    ],
    arrangements: [
      {
        id: "a1" as Song["arrangements"][0]["id"],
        name: "default", key: null, tempo: null, timeSignature: null, capo: null, notes: null,
        sequence: [
          { id: "as1" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "s1" as Song["sections"][0]["id"], repeats: 1, prefix: null },
          { id: "as2" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "s2" as Song["sections"][0]["id"], repeats: 2, prefix: null },
        ],
      },
    ],
    background: null,
    backgrounds: null,
    notes: null,
    hymnNumber: null,
    presentationRaw: null,
    linkedSongs: [],
    styleXml: null,
    styleBackgroundKey: null,
    extras: [],
  };
}

const service: Service = {
  id: "svc" as Service["id"],
  revision: REV as Service["revision"],
  name: "SVC", date: null, description: null,
  items: [
    {
      id: "i1" as Service["items"][0]["id"], kind: "song", songId: "song1" as Song["id"],
      arrangementId: null, mediaAssetId: null, title: "Test Song", subtitle: null, notes: null,
      slides: [], loopSeconds: 0, config: {},
    },
    {
      id: "i2" as Service["items"][0]["id"], kind: "custom-slides", songId: null,
      arrangementId: null, mediaAssetId: null, title: "Welcome", subtitle: null, notes: null,
      slides: [{ body: "Welcome!" }], loopSeconds: 0, config: {},
    },
  ],
};

const plan = buildPlan(service, new Map([["song1" as Song["id"], song("song1")]]));

describe("buildPlan", () => {
  it("expands arrangement sequence × repeats × slices", () => {
    // s1 has 2 slices, s2 has 1 slice, s2 repeats twice → 4 song slides + 1 custom,
    // plus OpenSong style/@blanks separators: before each item + one trailing.
    expect(plan.slides).toHaveLength(8);
    expect(plan.slides[0]!.blank).toBe(true); // separator before "Test Song"
    expect(plan.slides[1]!.lines).toEqual(["line1"]);
    expect(plan.slides[2]!.lines).toEqual(["line2"]);
    expect(plan.slides[3]!.sectionInstanceId).toBe("as2");
    expect(plan.slides[4]!.sectionInstanceId).toBe("as2"); // repeat
    expect(plan.slides[5]!.blank).toBe(true); // separator before "Welcome"
    expect(plan.slides[6]!.title).toBe("Welcome");
    expect(plan.slides[7]!.blank).toBe(true); // trailing separator
  });

  it("inserts a blank separator before each item and one at the end (OpenSong style/@blanks)", () => {
    const blanks = plan.slides.filter((s) => s.blank);
    expect(blanks).toHaveLength(3); // before "Test Song", before "Welcome", trailing
    // The separator belongs to the following item — it shows that item's background.
    expect(plan.slides[0]!.serviceItemId).toBe("i1");
    expect(plan.slides[5]!.serviceItemId).toBe("i2");
    expect(plan.slides[7]!.serviceItemId).toBe("i2");
    // Same-named items get no separator between them.
    const same = { ...service, items: [service.items[0]!, { ...service.items[0]!, id: "i1b" as never }] };
    expect(buildPlan(same, new Map([["song1" as Song["id"], song("song1")]])).slides.filter((s) => s.blank)).toHaveLength(2);
  });

  it("position round-trips through slide indices", () => {
    const pos = positionOfSlide(plan, 2, "sess" as never);
    expect(indexOfPosition(plan, pos)).toBe(2);
    expect(pos.sectionInstanceId).toBe("as1");
    expect(pos.positionWithinSection).toBe(1);
    expect(pos.serviceItemId).toBe("i1");
  });

  it("filters section lines by verse prefix", () => {
    const s = song("song2");
    s.sections = [
      {
        id: "sv" as Song["sections"][0]["id"], type: "verse", label: "V", options: {},
        lines: [
          { text: "v1a", chords: [], breakBefore: "none", prefix: "1", kind: "lyric", lang: null },
          { text: "v1b", chords: [], breakBefore: "none", prefix: "1", kind: "lyric", lang: null },
          { text: "v2a", chords: [], breakBefore: "bar", prefix: "2", kind: "lyric", lang: null },
        ],
      },
    ];
    s.arrangements[0]!.sequence = [
      { id: "p1" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sv" as Song["sections"][0]["id"], repeats: 1, prefix: "1" },
      { id: "p2" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sv" as Song["sections"][0]["id"], repeats: 1, prefix: "2" },
    ];
    const svc = { ...service, items: [service.items[0]!] };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], s]]));
    expect(p.slides.filter((sl) => !sl.blank).map((sl) => sl.lines)).toEqual([["v1a", "v1b"], ["v2a"]]);
  });

  it("strips underscores and squeezes spaces like OpenSong slides", () => {
    const s = song("song3");
    s.sections = [
      {
        id: "su" as Song["sections"][0]["id"], type: "verse", label: "V", options: {},
        lines: [{ text: "choo___sing  a   mighty  fort_re__ss", chords: [], breakBefore: "none", prefix: "1", kind: "lyric", lang: null }],
      },
    ];
    s.arrangements[0]!.sequence = [
      { id: "p1" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "su" as Song["sections"][0]["id"], repeats: 1, prefix: null },
    ];
    const svc = { ...service, items: [service.items[0]!] };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], s]]));
    expect(p.slides[1]!.lines).toEqual(["choosing a mighty fortress"]);
  });

  it("assigns verse backgrounds to matching section slides, cycling slices", () => {
    const s = song("song4");
    s.backgrounds = {
      resize: "screen", keepAspect: true, link: false, asText: false,
      items: [
        { verse: "V1", key: "media/bg-a.png", filename: "a.png" },
        { verse: "V1", key: "media/bg-b.png", filename: "b.png" },
        { verse: "C", key: "media/bg-c.png", filename: "c.png" },
      ],
    };
    const svc = { ...service, items: [service.items[0]!] };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], s]]));
    // V1 has 2 slices -> bg-a then bg-b; C slices -> bg-c each repeat
    expect(p.slides[1]!.backgroundKey).toBe("media/bg-a.png");
    expect(p.slides[2]!.backgroundKey).toBe("media/bg-b.png");
    expect(p.slides[3]!.backgroundKey).toBe("media/bg-c.png");
    expect(p.slides[4]!.backgroundKey).toBe("media/bg-c.png");
    expect(p.slides.every((x) => !x.backgroundAsText)).toBe(true);
  });

  it("marks slides background_as_text when the flag is set", () => {
    const s = song("song5");
    s.backgrounds = {
      resize: "", keepAspect: false, link: false, asText: true,
      items: [{ verse: "V1", key: "media/bg.png", filename: null }],
    };
    const svc = { ...service, items: [service.items[0]!] };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], s]]));
    expect(p.slides[1]!.backgroundAsText).toBe(true);
    expect(p.slides[3]!.backgroundAsText).toBe(false); // C has no background
  });

  it("maps imported OpenSong image groups to media slides (R2)", () => {
    const svc: Service = {
      ...service,
      items: [
        {
          id: "img1" as Service["items"][0]["id"], kind: "media", songId: null,
          arrangementId: null, mediaAssetId: null, title: "Logo",
          subtitle: null, notes: null, slides: [], loopSeconds: 0,
          config: { openSongType: "image", images: [{ storageKey: "media/a.jpg" }, { storageKey: "media/b.jpg" }] },
        },
      ],
    };
    const p = buildPlan(svc, new Map());
    expect(p.slides).toHaveLength(4); // blank + 2 media + trailing blank
    expect(p.slides[1]!.mediaKey).toBe("media/a.jpg");
    expect(p.slides[2]!.mediaKey).toBe("media/b.jpg");
  });

  it("carries OpenSong per-group timing (@seconds/@loop/@transition) and @emphasize", () => {
    const svc: Service = {
      ...service,
      items: [
        { ...service.items[0]!, config: { seconds: 12, loop: true, transition: "2" } },
      ],
    };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], song("song1")]]));
    const content = p.slides.filter((s) => !s.blank);
    expect(content.every((s) => s.seconds === 12 && s.loop && s.transition === 2)).toBe(true);
    // Chorus slides (section label C*) are emphasized; verses are not.
    expect(content.filter((s) => s.emphasize).map((s) => s.title)).toEqual([
      "Test Song — C",
      "Test Song — C",
    ]);
    // Blank separator groups carry no timing in OpenSong — never auto-advance.
    expect(p.slides.filter((s) => s.blank).every((s) => s.seconds === 0 && !s.loop)).toBe(true);
  });

  it("type=style items emit no slides and push/pop the set-level style", () => {
    const item = (id: string, kind: Service["items"][0]["kind"], config = {}) => ({
      id: id as Service["items"][0]["id"], kind, songId: null,
      arrangementId: null, mediaAssetId: null, title: id, subtitle: null, notes: null,
      slides: [{ body: "body" }], loopSeconds: 0, config,
    });
    const dark = { backgroundColor: "#000020" };
    const svc: Service = {
      ...service,
      items: [
        item("a", "custom-slides"),
        item("s1", "style", { action: "new", style: dark }),
        item("b", "custom-slides"),
        item("s2", "style", { action: "revert" }),
        item("c", "custom-slides"),
      ],
    };
    const p = buildPlan(svc, new Map());
    const content = p.slides.filter((s) => !s.blank);
    // Style groups emit no slides: 3 items x 1 body slide each.
    expect(content.map((s) => s.title)).toEqual(["a", "b", "c"]);
    // "b" is under the pushed style; "a" and "c" are not.
    const byTitle = (t: string) => content.find((s) => s.title === t)!;
    expect(byTitle("a").styleOverride).toBeNull();
    expect(byTitle("a").setStyleActive).toBe(false);
    expect(byTitle("b").styleOverride?.backgroundColor).toBe("#000020");
    expect(byTitle("b").setStyleActive).toBe(true);
    expect(byTitle("c").styleOverride).toBeNull();
    // Item's own <style> merges over the style-change (item wins).
    const svc2 = { ...svc, items: svc.items.map((i, n) => n === 2 ? { ...i, config: { ...i.config, style: { backgroundColor: "#FF0000" } } } : i) };
    const p2 = buildPlan(svc2, new Map());
    const b2 = p2.slides.find((s) => !s.blank && s.title === "b")!;
    expect(b2.styleOverride?.backgroundColor).toBe("#FF0000");
  });

  it("applies a song-level <style> per OpenSong's song_style rules", () => {
    const styled = song("styled");
    styled.styleXml = `<style>
      <title enabled="true" valign="bottom" align="center" font="Arial" size="26" bold="true" italic="true" underline="false" color="#FFFFFF00" border="true" border_color="#00000000" shadow="true" shadow_color="#00000000" fill="false" fill_color="#00000000"/>
      <body enabled="true" auto_scale="true" valign="middle" align="center" font="Arial" size="44" bold="true" italic="false" underline="false" color="#FFAA0000" border="true" border_color="#00000000" shadow="true" shadow_color="#00000000" fill="false" fill_color="#00000000"/>
      <background color="#123456"/>
    </style>`;
    const songs = new Map<Song["id"], Song>([["song1" as Song["id"], styled]]);
    const svc = { ...service, items: [service.items[0]!] };

    // No item style + no set style-change → the song's style wins outright.
    const p = buildPlan(svc, songs);
    expect(p.slides[1]!.styleOverride?.body?.size).toBe(44);
    expect(p.slides[1]!.styleOverride?.body?.color).toBe("#FFAA0000");
    expect(p.slides[1]!.styleOverride?.backgroundColor).toBe("#123456");
    // The item's leading blank separator carries the song style too.
    expect(p.slides[0]!.styleOverride?.body?.size).toBe(44);

    // The item's own <style> always beats song_style.
    const withItem = { ...svc, items: [{ ...svc.items[0]!, config: { style: { body: { size: 22 } } } }] };
    expect(buildPlan(withItem, songs).slides[1]!.styleOverride?.body?.size).toBe(22);

    // A set style-change suppresses song_style only when preferred is off.
    const dark = { backgroundColor: "#000020" };
    const withChange = {
      ...svc,
      items: [
        { id: "st" as Service["items"][0]["id"], kind: "style" as const, songId: null,
          arrangementId: null, mediaAssetId: null, title: "style", subtitle: null, notes: null,
          slides: [], loopSeconds: 0, config: { action: "new", style: dark } },
        svc.items[0]!,
      ],
    };
    expect(buildPlan(withChange, songs).slides[1]!.styleOverride?.body?.size).toBe(44); // preferred default
    const off = buildPlan(withChange, songs, { songStylePreferred: false });
    expect(off.slides[1]!.styleOverride?.backgroundColor).toBe("#000020"); // stack wins
    expect(off.slides[1]!.styleOverride?.body?.size).toBeUndefined();

    // A song without <style> is unaffected.
    const plain = buildPlan(svc, new Map([["song1" as Song["id"], song("song1")]]));
    expect(plain.slides[1]!.styleOverride).toBeNull();
  });

  it("carries bilingual (L) line languages onto slides", () => {
    const bi = song("bi");
    bi.sections = [
      {
        id: "sb" as Song["sections"][0]["id"], type: "verse", label: "V1", options: { L: null },
        lines: [
          { text: "English one", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: 1 },
          { text: "Deutsch eins", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: 2 },
          { text: "English two", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: 1 },
          { text: "Deutsch zwei", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: 2 },
        ],
      },
    ];
    bi.arrangements[0]!.sequence = [
      { id: "pb" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sb" as Song["sections"][0]["id"], repeats: 1, prefix: null },
    ];
    const svc = { ...service, items: [service.items[0]!] };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], bi]]));
    expect(p.slides[1]!.langs).toEqual([1, 2, 1, 2]);
    // Non-bilingual slides carry lang 1 for every line.
    const mono = buildPlan(svc, new Map([["song1" as Song["id"], song("song1")]]));
    expect(mono.slides[1]!.langs).toEqual([1]);
  });

  it("gates blank-line breaks on blank_is_slide_change (presentation-time setting)", () => {
    // A "slide" break is a blank source line: it splits only when the
    // runtime setting is on; "bar" (||) always splits (SongML semantics).
    const s = song("blanky");
    s.sections = [
      {
        id: "sb2" as Song["sections"][0]["id"], type: "verse", label: "V", options: {},
        lines: [
          { text: "a", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: null },
          { text: "b", chords: [], breakBefore: "slide", prefix: null, kind: "lyric", lang: null },
          { text: "c", chords: [], breakBefore: "bar", prefix: null, kind: "lyric", lang: null },
        ],
      },
    ];
    s.arrangements[0]!.sequence = [
      { id: "pb2" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sb2" as Song["sections"][0]["id"], repeats: 1, prefix: null },
    ];
    const svc = { ...service, items: [service.items[0]!] };
    const off = buildPlan(svc, new Map([["song1" as Song["id"], s]]));
    expect(off.slides.filter((sl) => !sl.blank).map((sl) => sl.lines)).toEqual([["a", "b"], ["c"]]);
    const on = buildPlan(svc, new Map([["song1" as Song["id"], s]]), { blankIsSlideChange: true });
    expect(on.slides.filter((sl) => !sl.blank).map((sl) => sl.lines)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("does not split numbered verses on blank lines (SongML dict model)", () => {
    // Blanks land in the "" subsection, never inside digit subsections —
    // a "slide" break on a digit-prefixed line is ignored at presentation
    // (re-review B1: A Mighty Fortress must stay V1 V2 V3 V4 when
    // blank_is_slide_change is on).
    const s = song("numbered");
    s.sections = [
      {
        id: "sn" as Song["sections"][0]["id"], type: "verse", label: "V", options: {},
        lines: [
          { text: "v1a", chords: [], breakBefore: "none", prefix: "1", kind: "lyric", lang: null },
          { text: "v1b", chords: [], breakBefore: "none", prefix: "1", kind: "lyric", lang: null },
          { text: "c1", chords: [], breakBefore: "slide", prefix: "1", kind: "lyric", lang: null },
          { text: "v2", chords: [], breakBefore: "none", prefix: "2", kind: "lyric", lang: null },
        ],
      },
    ];
    s.arrangements[0]!.sequence = [
      { id: "pn1" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sn" as Song["sections"][0]["id"], repeats: 1, prefix: "1" },
      { id: "pn2" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sn" as Song["sections"][0]["id"], repeats: 1, prefix: "2" },
    ];
    const svc = { ...service, items: [service.items[0]!] };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], s]]), { blankIsSlideChange: true });
    expect(p.slides.filter((sl) => !sl.blank).map((sl) => sl.lines)).toEqual([
      ["v1a", "v1b", "c1"],
      ["v2"],
    ]);
  });

  it("keeps |/|| pieces of numbered lines in their verse instance (re-review C1)", () => {
    // A digit-prefixed line split on | or || belongs to that subsection —
    // the continuation piece must not be filtered out (The Solid Rock V3).
    const { sections } = parseOpenSongLyrics("[V]\n1numA one||numA two\n2numB one|numB two");
    const s = song("pieces");
    s.sections = [
      { id: "sp" as Song["sections"][0]["id"], ...sections[0]! },
    ];
    s.arrangements[0]!.sequence = [
      { id: "pp1" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sp" as Song["sections"][0]["id"], repeats: 1, prefix: "1" },
      { id: "pp2" as Song["arrangements"][0]["sequence"][0]["id"], sectionId: "sp" as Song["sections"][0]["id"], repeats: 1, prefix: "2" },
    ];
    const svc = { ...service, items: [service.items[0]!] };
    const p = buildPlan(svc, new Map([["song1" as Song["id"], s]]));
    // V1: the || splits into two slides; V2: the | stays one slide, two lines.
    expect(p.slides.filter((sl) => !sl.blank).map((sl) => sl.lines)).toEqual([
      ["numA one"],
      ["numA two"],
      ["numB one", "numB two"],
    ]);
  });

  it("navigates with clamping", () => {
    const sess = "sess" as never;
    const p0 = positionOfSlide(plan, 0, sess);
    expect(indexOfPosition(plan, navigate(plan, p0, "next"))).toBe(1);
    expect(indexOfPosition(plan, navigate(plan, p0, "prev"))).toBe(0); // clamped
    expect(indexOfPosition(plan, navigate(plan, p0, "last"))).toBe(7);
    const pEnd = positionOfSlide(plan, 7, sess);
    expect(indexOfPosition(plan, navigate(plan, pEnd, "next"))).toBe(7); // clamped
  });
});
