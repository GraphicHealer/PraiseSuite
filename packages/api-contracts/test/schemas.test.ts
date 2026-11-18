import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  CreateSongInputSchema,
  HealthResponseSchema,
} from "../src/index.js";

describe("api contracts", () => {
  it("validates a create-song payload", () => {
    const parsed = CreateSongInputSchema.parse({ title: "Amazing Grace" });
    expect(parsed.title).toBe("Amazing Grace");
    expect(() => CreateSongInputSchema.parse({ title: "" })).toThrow();
  });

  it("reports the wire-format version", () => {
    expect(API_VERSION).toBe(1);
    expect(
      HealthResponseSchema.parse({
        status: "ok",
        apiVersion: API_VERSION,
        appVersion: "0.0.1",
      }).status,
    ).toBe("ok");
  });
});
