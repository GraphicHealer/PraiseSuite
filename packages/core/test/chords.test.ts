import { describe, expect, it } from "vitest";
import {
  capoFingering,
  formatChord,
  keyDistance,
  keyPrefersFlats,
  noteToSemitone,
  parseChord,
  semitoneToNote,
  transposeChord,
} from "../src/index.js";

describe("parseChord", () => {
  it("parses simple and extended chords", () => {
    expect(parseChord("G")).toMatchObject({ root: "G", quality: "", bass: null });
    expect(parseChord("Am")).toMatchObject({ root: "A", quality: "m" });
    expect(parseChord("D7")).toMatchObject({ root: "D", extensions: ["7"] });
    expect(parseChord("Cmaj7")).toMatchObject({ root: "C", quality: "maj", extensions: ["7"] });
    expect(parseChord("Asus4")).toMatchObject({ root: "A", quality: "sus4" });
    expect(parseChord("F#dim")).toMatchObject({ root: "F#", quality: "dim" });
  });

  it("parses slash chords and alternate bass", () => {
    expect(parseChord("Am/C")).toMatchObject({ root: "A", quality: "m", bass: "C" });
    expect(parseChord("G/B")).toMatchObject({ root: "G", bass: "B" });
    expect(parseChord("D/F#")).toMatchObject({ root: "D", bass: "F#" });
  });

  it("parses alterations", () => {
    const c = parseChord("C#m7b5");
    expect(c.root).toBe("C#");
    expect(c.quality).toBe("m");
    expect(c.extensions).toContain("7");
    expect(c.alterations).toContain("b5");
  });

  it("preserves unparseable text verbatim", () => {
    const c = parseChord("N.C.");
    expect(c.raw).toBe("N.C.");
    expect(c.root).toBe("");
    expect(formatChord(c)).toBe("N.C.");
  });

  it("round-trips through formatChord", () => {
    for (const t of ["G", "Am", "D7", "Am/C", "G/B", "C#m7b5", "Bbmaj7", "Esus", "D/F#"]) {
      expect(formatChord(parseChord(t))).toBe(t);
    }
  });
});

describe("transpose", () => {
  it("transposes roots and bass, keeping suffixes", () => {
    expect(transposeChord(parseChord("G"), 2).display).toBe("A");
    expect(transposeChord(parseChord("Am/C"), 3).display).toBe("Cm/D#");
    expect(transposeChord(parseChord("Cmaj7"), -2).display).toBe("Bbmaj7");
  });

  it("spells enharmonics for flat keys", () => {
    expect(transposeChord(parseChord("A"), 1, { targetKey: "Eb" }).display).toBe("Bb");
    expect(transposeChord(parseChord("A"), 1, { preferFlats: false }).display).toBe("A#");
    expect(keyPrefersFlats("Eb")).toBe(true);
    expect(keyPrefersFlats("E")).toBe(false);
  });

  it("leaves unparseable chords alone", () => {
    const c = parseChord("N.C.");
    expect(transposeChord(c, 5)).toBe(c);
  });

  it("computes key distance", () => {
    expect(keyDistance("C", "Eb")).toBe(3);
    expect(keyDistance("G", "C")).toBe(5);
    expect(keyDistance("X", "C")).toBeNull();
  });

  it("capo fingering shifts down", () => {
    expect(capoFingering(parseChord("D"), 2).display).toBe("C");
    expect(capoFingering(parseChord("G/B"), 2).display).toBe("F/A");
  });
});

describe("notes", () => {
  it("maps notes to semitones", () => {
    expect(noteToSemitone("C")).toBe(0);
    expect(noteToSemitone("B")).toBe(11);
    expect(noteToSemitone("C#")).toBe(1);
    expect(noteToSemitone("Db")).toBe(1);
    expect(noteToSemitone("F♭")).toBe(4);
    expect(noteToSemitone("H")).toBeNull();
  });
  it("spells semitones back", () => {
    expect(semitoneToNote(1, false)).toBe("C#");
    expect(semitoneToNote(1, true)).toBe("Db");
    expect(semitoneToNote(13, false)).toBe("C#");
  });
});
