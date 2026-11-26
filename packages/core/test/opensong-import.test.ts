import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  analyzeImport,
  applyImport,
  buildPlan,
  detectDuplicates,
  existingInfo,
  expandZip,
  materializeSong,
  parseOpenSongLyrics,
  parseOpenSongSet,
  parseOpenSongSong,
  parseStyleOverride,
  serializeOpenSongSong,
  transposeSourceText,
  type IdGenerator,
  type Service,
  type Song,
  type SongSummary,
} from "../src/index.js";
import { asRecord, parseXml } from "../src/import/opensong/xml.js";
import { strToU8, zipSync } from "fflate";

const FIXTURES = resolve(
  process.cwd(),
  "../../infrastructure/fixtures/opensong-defaults",
);
const SONGS_DIR = join(FIXTURES, "Songs");
const SETS_DIR = join(FIXTURES, "Sets");

let n = 0;
const ids: IdGenerator = { next: () => `id-${++n}` };

function fixtureSong(name: string): string {
  return readFileSync(join(SONGS_DIR, name), "utf8");
}

describe("lyrics parser", () => {
  it("anchors chords at correct lyric offsets (Amazing Grace V1)", () => {
    const { sections } = parseOpenSongLyrics(
      "[V1]\n. D      D7        G         D          Bm      E           A  A7\n Amazing grace how sweet the sound that saved a wretch like me;",
    );
    expect(sections).toHaveLength(1);
    const s = sections[0]!;
    expect(s.type).toBe("verse");
    expect(s.label).toBe("V1");
    const line = s.lines[0]!;
    expect(line.text).toBe("Amazing grace how sweet the sound that saved a wretch like me;");
    // ". D": D at index 2 in the dot line -> offset 1 (over 'm' of "Amazing")
    expect(line.chords[0]!.offset).toBe(1);
    expect(line.chords[0]!.chord.root).toBe("D");
    expect(line.chords.map((c) => c.chord.root)).toEqual(["D", "D", "G", "D", "B", "E", "A", "A"]);
  });

  it("splits | inline breaks and re-bases chord offsets", () => {
    const { sections } = parseOpenSongLyrics(
      "[V1]\n.   A      B\n first part|second part",
    );
    expect(sections[0]!.lines).toHaveLength(2);
    expect(sections[0]!.lines[0]!.breakBefore).toBe("none");
    expect(sections[0]!.lines[1]!.breakBefore).toBe("inline");
    expect(sections[0]!.lines[1]!.text).toBe("second part");
    // 'B' at index 9 -> original offset 8; 'second part' starts at 11 -> rebased 8-11 <0? check filter
  });

  it("re-bases chords after | at the exact column (re-review R1)", () => {
    const { sections } = parseOpenSongLyrics(
      "[V1]\n.G               Am/C D      G        C D      G     D A      D\n" +
        " And can be that I    should gain,|an interest in my Savior's blood?",
    );
    const piece = sections[0]!.lines.find((l) => l.text.startsWith("an interest"));
    expect(piece).toBeDefined();
    // Chords sit directly over their lyric columns — not shifted by the bar.
    expect(piece!.chords.map((c) => [c.offset, c.chord.root])).toEqual([
      [3, "C"], [5, "D"], [12, "G"], [18, "D"], [20, "A"], [27, "D"],
    ]);
  });

  it("preserves blank lines as conditional slide breaks (verbatim storage)", () => {
    // SongML stores <lyrics> verbatim: blanks always parse to "slide" breaks
    // so they export back exactly; blank_is_slide_change only decides
    // whether they split slides at presentation time (buildPlan).
    const { sections } = parseOpenSongLyrics("[V1]\n line one\n\n line two");
    expect(sections[0]!.lines).toHaveLength(2);
    expect(sections[0]!.lines[1]!.breakBefore).toBe("slide");
  });

  it("treats || as a slide break and | as a line break within the slide", () => {
    // SongML AdjustSlideBreaks splits on "||"; DeflateString maps "|" to
    // a newline inside the slide body.
    const { sections } = parseOpenSongLyrics(
      "[V1]\n line a|line b\n line c||line d",
    );
    const lines = sections[0]!.lines;
    expect(lines).toHaveLength(4);
    expect(lines[1]!.breakBefore).toBe("inline");
    expect(lines[3]!.breakBefore).toBe("bar");
    expect(lines[3]!.text).toBe("line d");
  });

  it("handles comments and directives", () => {
    const { sections } = parseOpenSongLyrics("[V1]\n;a comment\n-!!\n line");
    expect(sections[0]!.lines[0]!.kind).toBe("comment");
    expect(sections[0]!.lines[0]!.text).toBe("a comment");
    expect(sections[0]!.lines[1]!.kind).toBe("directive");
    expect(sections[0]!.lines[1]!.text).toBe("!!");
  });

  it("parses digit-prefixed lyric lines", () => {
    const { sections } = parseOpenSongLyrics("[V1]\n1 first verse\n2 second verse");
    expect(sections[0]!.lines[0]!.prefix).toBe("1");
    // Only the 1-char prefix column is stripped (OpenSong Mid(line,2)); the
    // alignment space remains so the line round-trips byte-for-byte.
    expect(sections[0]!.lines[0]!.text).toBe(" first verse");
  });

  it("parses section options and legacy bilingual", () => {
    const { sections } = parseOpenSongLyrics("[B](L;L1=en;L2=de)\n en line\n de line\n[V2L]\n a\n b");
    expect(sections[0]!.options).toEqual({ L: null, L1: "en", L2: "de" });
    expect(sections[0]!.lines[0]!.lang).toBe(1);
    expect(sections[0]!.lines[1]!.lang).toBe(2);
    expect(sections[1]!.label).toBe("V2");
    expect(sections[1]!.options["L"]).toBeNull();
    expect(sections[1]!.lines[0]!.lang).toBe(1);
  });
});

describe("song parser", () => {
  it("parses Amazing Grace with metadata + arrangement", () => {
    const { song, warnings } = parseOpenSongSong(fixtureSong("Amazing Grace"));
    expect(warnings).toEqual([]);
    expect(song.title).toBe("Amazing Grace");
    expect(song.authors).toEqual(["John Newton"]);
    expect(song.copyright).toBe("1982 Jubilate Hymns Limited");
    expect(song.ccliNumber).toBe("1037882");
    expect(song.theme).toBe("God: Attributes");
    expect(song.sections.map((s) => s.label)).toEqual(["V1", "V2", "V3", "V4"]);
    expect(song.arrangements[0]!.sequence).toHaveLength(4);
  });

  it("maps <presentation> to arrangement sequence (And Can It Be)", () => {
    const { song } = parseOpenSongSong(fixtureSong("And Can It Be"));
    const labels = song.sections.map((s) => s.label);
    expect(song.arrangements[0]!.sequence.map((x) => labels[x.sectionIndex])).toEqual([
      "V1", "C", "V2", "C", "V3", "C",
    ]);
  });

  it("resolves verse-instance tags V1->[V] prefix 1 (A Mighty Fortress)", () => {
    const { song } = parseOpenSongSong(fixtureSong("A Mighty Fortress is Our God"));
    expect(song.sections.map((s) => s.label)).toEqual(["V"]);
    expect(
      song.arrangements[0]!.sequence.map((x) => ({
        label: song.sections[x.sectionIndex]!.label,
        prefix: x.prefix,
      })),
    ).toEqual([
      { label: "V", prefix: "1" },
      { label: "V", prefix: "2" },
      { label: "V", prefix: "3" },
      { label: "V", prefix: "4" },
    ]);
  });

  it("warns on unknown presentation tags", () => {
    const xml = `<?xml version="1.0"?><song><title>T</title><presentation>V1 C9</presentation><lyrics>[V1]\n x</lyrics></song>`;
    const { warnings } = parseOpenSongSong(xml);
    expect(warnings.some((w) => w.includes("C9"))).toBe(true);
  });

  it("parses <backgrounds> verse images with fit/link/as-text flags", () => {
    const xml = `<?xml version="1.0"?><song><title>T</title><lyrics>[V1]\n x</lyrics>
      <backgrounds resize="screen" keep_aspect="true" link="false" background_as_text="true">
        <background verse="V1"><image>QUJD</image></background>
        <background verse="C"><filename>clouds.jpg</filename></background>
      </backgrounds></song>`;
    const { song } = parseOpenSongSong(xml);
    expect(song.backgrounds?.resize).toBe("screen");
    expect(song.backgrounds?.keepAspect).toBe(true);
    expect(song.backgrounds?.asText).toBe(true);
    expect(song.backgrounds?.items).toEqual([
      { verse: "V1", filename: null, imageData: "QUJD" },
      { verse: "C", filename: "clouds.jpg", imageData: null },
    ]);
  });

  it("parses <linked_songs> child elements (and legacy newline text)", () => {
    const childForm = `<?xml version="1.0"?><song><title>T</title><lyrics>[V1]\n x</lyrics>
      <linked_songs><linked_song>Song A</linked_song><linked_song> Song B </linked_song></linked_songs></song>`;
    expect(parseOpenSongSong(childForm).song.linkedSongs).toEqual(["Song A", "Song B"]);
    const legacyText = `<?xml version="1.0"?><song><title>T</title><lyrics>[V1]\n x</lyrics>
      <linked_songs>Song A\nSong B</linked_songs></song>`;
    expect(parseOpenSongSong(legacyText).song.linkedSongs).toEqual(["Song A", "Song B"]);
    const empty = `<?xml version="1.0"?><song><title>T</title><lyrics>[V1]\n x</lyrics><linked_songs/></song>`;
    expect(parseOpenSongSong(empty).song.linkedSongs).toEqual([]);
  });

  it("captures a song-level <style> verbatim (and its embedded background)", () => {
    const xml = `<?xml version="1.0"?><song><title>T</title><lyrics>[V1]\n x</lyrics>
      <style>
        <title enabled="true" valign="bottom" align="center" font="Arial" size="26"/>
        <body enabled="true" auto_scale="true" font="Arial" size="34" multilanguage_size="65" multilanguage_color="#AABBCC">
          <tabs><tab position="120" align="left"/><tab position="300" align="right"/></tabs>
        </body>
        <background strip_footer="10" color="#40808000" image_fit="1" image_pos_left="0.25" image_pos_top="0.75">QUJD</background>
      </style></song>`;
    const { song } = parseOpenSongSong(xml);
    expect(song.styleXml).not.toBeNull();
    expect(song.styleXml).toContain("<style>");
    expect(song.styleXml).toContain("multilanguage_size");
    // <style> is modeled now — it must NOT also land in extras.
    expect(song.extras.every((x) => !x.includes("<style"))).toBe(true);
    expect(song.styleBackgroundData).toBe("QUJD");

    // The style parses into a full override through the plan's path.
    const ov = parseStyleOverride(asRecord(parseXml(song.styleXml!))["style"]);
    expect(ov.body?.multilanguageSize).toBe(65);
    expect(ov.body?.multilanguageColor).toBe("#AABBCC");
    expect(ov.bodyTabs).toEqual([
      { position: 120, align: "left" },
      { position: 300, align: "right" },
    ]);
    expect(ov.backgroundFit).toBe("contain");
    expect(ov.backgroundStripFooter).toBe(10);
    expect(ov.backgroundPosX).toBe(0.25);
    expect(ov.backgroundPosY).toBe(0.75);
  });
});

describe("transposeSourceText", () => {
  it("transposes . chord tokens in place, document untouched", () => {
    const src = "[V1]\n.G        C        D\n Amazing   grace    how\n;comment line\n\n[V2]\n.Bb       F\n Sweet     sound";
    const out = transposeSourceText(src, 2, {});
    const lines = out.split("\n");
    // chord tokens move, nothing else does
    expect(lines[0]).toBe("[V1]");
    expect(lines[2]).toBe(" Amazing   grace    how");
    expect(lines[3]).toBe(";comment line");
    expect(lines[1]).toBe(".A        D        E"); // G C D +2
    expect(lines[6]).toBe(".Cb       G"); // Bb F +2, flat spelling preserved
  });
  it("keeps a gap when a longer name overruns the next column", () => {
    const out = transposeSourceText(".G    Ab", -1, {}); // G->Gb (down=flat), Ab->G
    expect(out).toMatch(/^\.Gb\s+G/);
  });
});

describe("all 27 bundled songs parse", () => {
  const files = readdirSync(SONGS_DIR);
  it("imports every fixture song with sections and no errors", () => {
    expect(files.length).toBe(27);
    for (const f of files) {
      const { song } = parseOpenSongSong(readFileSync(join(SONGS_DIR, f), "utf8"));
      expect(song.title.length).toBeGreaterThan(0);
      expect(song.sections.length).toBeGreaterThan(0);
      for (const s of song.sections) {
        for (const l of s.lines) {
          for (const c of l.chords) {
            expect(c.offset).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe("set parser", () => {
  it("parses Sets/Example", () => {
    const xml = readFileSync(join(SETS_DIR, "Example"), "utf8");
    const { items } = parseOpenSongSet(xml, "Example");
    expect(items).toHaveLength(7);
    expect(items[0]!.kind).toBe("custom-slides");
    expect(items[0]!.title).toBe("Announcements");
    expect(items[0]!.loopSeconds).toBe(10);
    expect(items[1]!.kind).toBe("scripture");
    expect(items[1]!.slides.length).toBeGreaterThan(0);
    expect(items[2]!.kind).toBe("song");
    expect(items[2]!.songRef).toBe("And Can It Be");
  });
});

describe("round-trip export", () => {
  it("serializes backgrounds (link filenames) and re-parses them", () => {
    const parsed = parseOpenSongSong(fixtureSong("Amazing Grace")).song;
    parsed.backgrounds = {
      resize: "screen", keepAspect: true, link: true, asText: false,
      items: [{ verse: "V1", filename: "sky.jpg", imageData: null, key: "media/sky.png" }],
    };
    const song = materializeSong(parsed, ids);
    const xml = serializeOpenSongSong(song);
    expect(xml).toContain("<backgrounds");
    expect(xml).toContain('verse="V1"');
    const again = parseOpenSongSong(xml).song;
    expect(again.backgrounds?.keepAspect).toBe(true);
    expect(again.backgrounds?.link).toBe(true);
    expect(again.backgrounds?.items[0]).toMatchObject({ verse: "V1", filename: "sky.jpg" });
  });

  it("round-trips a song-level <style> verbatim", () => {
    const xml = `<?xml version="1.0"?><song><title>T</title><lyrics>[V1]\n x</lyrics>
      <style><title font="Arial" size="26"/><body font="Arial" size="34"/><background color="#40808000">QUJD</background></style></song>`;
    const parsed = parseOpenSongSong(xml).song;
    const song = materializeSong(parsed, ids);
    const out = serializeOpenSongSong(song);
    expect(out).toContain('<style><title font="Arial"');
    expect(out).toContain("QUJD");
    const again = parseOpenSongSong(out).song;
    expect(again.styleXml).toContain('size="26"');
  });

  it("serializes linked songs as <linked_song> children and re-parses them", () => {
    const parsed = parseOpenSongSong(fixtureSong("Amazing Grace")).song;
    parsed.linkedSongs = ["And Can It Be", "Are You Washed"];
    const song = materializeSong(parsed, ids);
    const xml = serializeOpenSongSong(song);
    expect(xml).toContain("<linked_songs>\n    <linked_song>And Can It Be</linked_song>");
    expect(xml).not.toContain("linked_songs>And Can It Be\n");
    const again = parseOpenSongSong(xml).song;
    expect(again.linkedSongs).toEqual(["And Can It Be", "Are You Washed"]);
  });

  it("serializes Amazing Grace and re-parses equivalently", () => {
    const original = parseOpenSongSong(fixtureSong("Amazing Grace")).song;
    const song = materializeSong(original, ids);
    const xml = serializeOpenSongSong(song);
    const reparsed = parseOpenSongSong(xml).song;
    expect(reparsed.title).toBe(song.title);
    expect(reparsed.sections.map((s) => s.label)).toEqual(
      song.sections.map((s) => s.label),
    );
    // chord annotations survive the round trip — names AND lyric offsets
    // (the serializer must not shift chord columns)
    for (let i = 0; i < song.sections.length; i++) {
      const a = song.sections[i]!.lines.flatMap((l) => l.chords.map((c) => `${c.chord.display}@${c.offset}`));
      const b = reparsed.sections[i]!.lines.flatMap((l) => l.chords.map((c) => `${c.chord.display}@${c.offset}`));
      expect(b).toEqual(a);
    }
  });

  it("falls back to section order when provenance is incomplete", () => {
    // A line edited in place (no sourceLine) can't be placed in the
    // source-order merge — the untagged block falls back to per-section
    // order instead of moving the line to the end.
    const parsed = parseOpenSongSong(fixtureSong("Man Of Sorrows")).song;
    const song = materializeSong(parsed, ids);
    const newLine = { ...song.sections[0]!.lines[0]!, text: "EDITED" };
    delete newLine.sourceLine;
    song.sections[0]!.lines.splice(1, 0, newLine);
    const out = /<lyrics>([\s\S]*?)<\/lyrics>/.exec(serializeOpenSongSong(song))![1]!;
    expect(out).toContain("1Man of Sorrows");
    expect(out.indexOf("EDITED")).toBeLessThan(out.indexOf("Ruined sinners"));
  });

  it("falls back to section order when sourceLines are reordered", () => {
    // A structured edit that reorders lines but keeps stale sourceLines —
    // model order wins over stale provenance.
    const parsed = parseOpenSongSong(fixtureSong("Man Of Sorrows")).song;
    const song = materializeSong(parsed, ids);
    const lines = song.sections[0]!.lines;
    lines.reverse(); // [chorus1, verse1] — sourceLines no longer ascending
    const out = /<lyrics>([\s\S]*?)<\/lyrics>/.exec(serializeOpenSongSong(song))![1]!;
    expect(out.indexOf("Ruined sinners")).toBeLessThan(out.indexOf("Man of Sorrows"));
  });

  it("reconstructs dict-merged untagged lyrics in source order", () => {
    // Man Of Sorrows: untagged verse block 1-5 then chorus block 1-5 — the
    // dict merges them into [v1,c1] [v2,c2]…, and sourceLine provenance
    // interleaves them back on export (re-review: byte-identical round-trip).
    const src = fixtureSong("Man Of Sorrows");
    const parsed = parseOpenSongSong(src).song;
    const song = materializeSong(parsed, ids);
    const out = serializeOpenSongSong(song);
    const srcLyrics = /<lyrics>([\s\S]*?)<\/lyrics>/.exec(src)![1]!.replace(/\r\n?/g, "\n");
    const outLyrics = /<lyrics>([\s\S]*?)<\/lyrics>/.exec(out)![1]!;
    expect(outLyrics.split("\n").map((l) => l.trimEnd())).toEqual(
      srcLyrics.split("\n").map((l) => l.trimEnd()),
    );
  });
});

describe("duplicates + pipeline", () => {
  it("detects duplicates by CCLI and lyrics", () => {
    const a = parseOpenSongSong(fixtureSong("Amazing Grace")).song;
    const song = materializeSong(a, ids) as Song;
    const dups = detectDuplicates([a], [existingInfo(song)]);
    expect(dups.length).toBeGreaterThan(0);
    expect(dups[0]!.reasons).toContain("same-ccli");
  });

  it("analyzes a set of files", () => {
    const files = readdirSync(SONGS_DIR).map((f) => ({
      path: f,
      text: readFileSync(join(SONGS_DIR, f), "utf8"),
    }));
    files.push({ path: "Sets/Example", text: readFileSync(join(SETS_DIR, "Example"), "utf8") });
    const analysis = analyzeImport(files);
    expect(analysis.songs).toHaveLength(27);
    expect(analysis.sets).toHaveLength(1);
    expect(analysis.skipped).toHaveLength(0);
  });

  it("expands a zip archive", () => {
    const zip = new Map<string, Uint8Array>();
    zip.set("Songs/Amazing Grace", strToU8(fixtureSong("Amazing Grace")));
    zip.set("img/logo.png", strToU8("not-xml"));
    const zipped = zipToU8(zip);
    const files = expandZip(zipped);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("Songs/Amazing Grace");
  });

  it("applyImport persists sets, resolves song refs, and strips the Songs/ root (D1/D6)", async () => {
    const songs = new Map<string, Song>();
    const services = new Map<string, Service>();
    const repos = {
      songs: {
        get: async (id: Song["id"]) => songs.get(id) ?? null,
        save: async (s: Song) => void songs.set(s.id, s),
        delete: async () => {},
        list: async (): Promise<SongSummary[]> =>
          [...songs.values()].map((s) => ({ id: s.id, title: s.title, authors: s.authors, theme: s.theme, folder: s.folder })),
        search: async () => [],
      },
      services: {
        get: async (id: Service["id"]) => services.get(id) ?? null,
        save: async (s: Service) => void services.set(s.id, s),
        delete: async () => {},
        list: async () => [...services.values()],
      },
    };
    const files = [
      { path: "Songs/Amazing Grace", text: fixtureSong("Amazing Grace") },
      { path: "Songs/Hymns/And Can It Be", text: fixtureSong("And Can It Be") },
      { path: "Sets/Example", text: readFileSync(join(SETS_DIR, "Example"), "utf8") },
    ];
    const report = await applyImport(analyzeImport(files), ids, repos);
    expect(report.importedSongs).toBe(2);
    expect(report.importedSets).toBe(1);
    // "Songs" root stripped; real subfolder kept.
    const folders = [...songs.values()].map((s) => s.folder).sort();
    expect(folders).toEqual(["Hymns", null]);
    // Set persisted with the resolvable song linked, unresolved as placeholder.
    const svc = [...services.values()][0]!;
    expect(svc.items).toHaveLength(7);
    const resolved = svc.items.filter((i) => i.kind === "song" && i.songId !== null);
    expect(resolved).toHaveLength(1);
    expect(svc.items.filter((i) => i.kind === "song" && i.songId === null)).toHaveLength(3);
    expect(report.warnings.some((w) => w.includes("not found"))).toBe(true);
  });
});

// minimal zip writer via fflate for the test
function zipToU8(m: Map<string, Uint8Array>): Uint8Array {
  const rec: Record<string, Uint8Array> = {};
  for (const [k, v] of m) rec[k] = v;
  return zipSync(rec);
}

describe("slide counting vs OpenSong (re-review N1/N2)", () => {
  const planOf = (name: string) => {
    const song = materializeSong(parseOpenSongSong(fixtureSong(name)).song, ids);
    const service: Service = {
      id: "svc" as Service["id"],
      revision: {
        id: "r",
        parentId: null,
        origin: "t",
        createdAt: "2026-01-01T00:00:00Z",
      } as Service["revision"],
      name: "S",
      date: null,
      description: null,
      items: [
        {
          id: "i1" as Service["items"][0]["id"],
          kind: "song",
          songId: song.id,
          arrangementId: null,
          mediaAssetId: null,
          title: song.title,
          subtitle: null,
          notes: null,
          slides: [],
          loopSeconds: 0,
          config: {},
        },
      ],
    };
    return buildPlan(service, new Map([[song.id, song]]));
  };

  it("And Can It Be: | is a line break inside the slide — V1 is ONE slide", () => {
    const plan = planOf("And Can It Be");
    const v1 = plan.slides.filter((s) => s.title.endsWith("— V1"));
    expect(v1).toHaveLength(1);
    // Both halves of the |-split line render in that single slide.
    expect(v1[0]!.lines.join("\n")).toContain("an interest in my Savior");
  });

  it("Man Of Sorrows: 5 numbered verses = 5 slides, blank line is not a break", () => {
    const plan = planOf("Man Of Sorrows");
    expect(plan.slides.filter((x) => !x.blank)).toHaveLength(5);
  });
});
