import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp, type PraiseSuiteApp } from "../src/app.js";

let app: PraiseSuiteApp; let dir: string; let base: string; let token = "";
async function api(path: string, opts: RequestInit = {}, t?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (t) headers["authorization"] = `Bearer ${t}`;
  return fetch(`${base}${path}`, { ...opts, headers });
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "praisesuite-styles-"));
  app = createApp({ databasePath: join(dir, "db.sqlite") });
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  await api("/api/v1/auth/setup", { method: "POST", body: JSON.stringify({ name: "a", password: "pw" }) });
  const res = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ name: "a", password: "pw" }) });
  token = ((await res.json()) as { token: string }).token;
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

describe("named styles", () => {
  it("PUT saves a style and GET returns it under saved", async () => {
    const put = await api("/api/v1/styles/My%20Style", {
      method: "PUT", body: JSON.stringify({ backgroundColor: "#123456" }),
    }, token);
    expect(put.status).toBe(200);
    const saved = (await put.json()) as { name: string; style: { backgroundColor: string } };
    expect(saved.name).toBe("My Style");
    expect(saved.style.backgroundColor).toBe("#123456");

    const list = await api("/api/v1/styles", {}, token);
    const body = (await list.json()) as { saved: { name: string }[] };
    expect(body.saved.map((s) => s.name)).toContain("My Style");
  });
  it("rejects empty names", async () => {
    const res = await api("/api/v1/styles/%20", { method: "PUT", body: "{}" }, token);
    expect(res.status).toBe(400);
  });
});
