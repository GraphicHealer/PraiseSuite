import { describe, expect, it } from "vitest";
import {
  buildPlan,
  indexOfPosition,
  navigate,
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
    aka: null, keyLine: null, theme: null, secondaryTheme: null, folder: null,
    userFields: { user1: "", user2: "", user3: "" },
    sections: [
      {
        id: "s1" as Song["sections"][0]["id"],
        type: "verse", label: "V1", options: {},
        lines: [
          { text: "line1", chords: [], breakBefore: "none", prefix: null, kind: "lyric", lang: null },
          { text: "line2", chords: [], breakBefore: "slide", prefix: null, kind: "lyric", lang: null },
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
          { text: "v2a", chords: [], breakBefore: "slide", prefix: "2", kind: "lyric", lang: null },
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
