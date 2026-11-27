import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fontStack, resolveFont } from "../src/application/fonts.js";
import { resolveSlideStyle } from "../src/application/presentation/style.js";
import { defaultSlideStyle } from "../src/domain/styles/types.js";
import { parsePresentSettings, parsePrintSettings } from "../src/import/opensong/settings.js";

const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), "../../infrastructure/fixtures/opensong-defaults/Settings", name), "utf8");

describe("font resolution", () => {
  it("maps legacy OpenSong fonts to bundled families", () => {
    expect(resolveFont("Helvetica")).toBe("Inter");
    expect(resolveFont("System")).toBe("Inter");
    expect(resolveFont("Arial Narrow")).toBe("Inter");
    expect(resolveFont("Times New Roman")).toBe("Source Serif 4");
    expect(resolveFont("Courier New")).toBe("JetBrains Mono");
  });
  it("passes unknown fonts through and stacks fallbacks", () => {
    expect(resolveFont("Benton Sans")).toBe("Benton Sans");
    expect(fontStack("Helvetica")).toBe('"Inter", sans-serif');
    expect(fontStack("Courier New")).toBe('"JetBrains Mono", monospace');
  });
});

describe("PresentSettings import", () => {
  const r = parsePresentSettings(fixture("PresentSettings"));

  it("parses default title/body/subtitle styles", () => {
    expect(r.style.body.font).toBe("Inter"); // Helvetica resolved
    expect(r.style.body.size).toBe(34);
    expect(r.style.body.color).toBe("#FFFFFF");
    expect(r.style.body.align).toBe("center");
    expect(r.style.body.autoScale).toBe(true);
    expect(r.style.title.size).toBe(26);
    expect(r.style.subtitle.size).toBe(18);
  });
  it("captures background, logo and behavior options", () => {
    expect(r.style.backgroundColor).toBe("#408080");
    expect(r.backgroundData).toBeTruthy();
    expect(r.logoData).toBeTruthy();
    expect(r.logoMaskData).toBeTruthy();
    expect(r.options.transition).toBe(false);
    expect(r.options.transitionTime).toBe(50);
    expect(r.style.transitionMs).toBe(50);
    expect(r.songStylePreferred).toBe(true);
  });
  it("rejects non-settings XML", () => {
    expect(() => parsePresentSettings("<song/>")).toThrow();
  });
});

describe("PrintSettings import", () => {
  it("parses all print roles", () => {
    const roles = parsePrintSettings(fixture("PrintSettings"));
    expect(Object.keys(roles)).toEqual(
      expect.arrayContaining(["title", "author", "heading", "chords", "lyrics", "copyright"]),
    );
    expect(roles["lyrics"]!.font).toBe("Inter"); // Arial Narrow resolved
    expect(roles["copyright"]!.font).toBe("JetBrains Mono"); // Courier New resolved
  });
});

describe("style resolution chain", () => {
  it("applies item-level overrides over the global style", () => {
    const global = defaultSlideStyle();
    const resolved = resolveSlideStyle(global, {
      body: { size: 60, color: "#FF0000" },
      backgroundColor: "#112233",
    });
    expect(resolved.body.size).toBe(60);
    expect(resolved.body.color).toBe("#FF0000");
    expect(resolved.body.font).toBe(global.body.font); // untouched fields kept
    expect(resolved.title.size).toBe(global.title.size);
    expect(resolved.backgroundColor).toBe("#112233");
    // Global object must not be mutated.
    expect(global.body.size).not.toBe(60);
    expect(global.backgroundColor).not.toBe("#112233");
  });
  it("later overrides win (slide over item)", () => {
    const resolved = resolveSlideStyle(defaultSlideStyle(), { body: { size: 60 } }, { body: { size: 20 } });
    expect(resolved.body.size).toBe(20);
  });
});
