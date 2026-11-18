import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createApp, type PraiseSuiteApp } from "../src/app.js";

let app: PraiseSuiteApp;
let dir: string;
let base: string;
let adminToken = "";

async function api(path: string, opts: RequestInit = {}, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return fetch(`${base}${path}`, { ...opts, headers });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "praisesuite-srv-"));
  app = createApp({ databasePath: join(dir, "db.sqlite") });
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("api v1", () => {
  it("health is public", async () => {
    const res = await api("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", apiVersion: 1 });
  });

  it("openapi doc is served and matches routes", async () => {
    const res = await api("/api/v1/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths["/api/v1/songs"]).toBeDefined();
    expect(doc.paths["/api/v1/sessions/{id}/position"]).toBeUndefined();
  });

  it("requires setup before login; admin-only after", async () => {
    // login before setup fails
    let res = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "nope" }),
    });
    expect(res.status).toBe(401);

    res = await api("/api/v1/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    expect(res.status).toBe(200);

    // second setup rejected
    res = await api("/api/v1/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password: "another password" }),
    });
    expect(res.status).toBe(409);

    res = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    const { token } = (await res.json()) as { token: string };
    adminToken = token;
    expect(token).toMatch(/^v1\./);
  });

  it("songs CRUD requires admin", async () => {
    // unauthenticated list is 401 for guests? GET /songs is "guest" access — needs a token.
    let res = await api("/api/v1/songs");
    expect(res.status).toBe(401);

    res = await api("/api/v1/songs", {
      method: "POST",
      body: JSON.stringify({ title: "Amazing Grace", authors: ["John Newton"] }),
    }, adminToken);
    expect(res.status).toBe(200);
    const created = (await res.json()) as { id: string };

    res = await api("/api/v1/songs?query=amazing", {}, adminToken);
    const list = (await res.json()) as { title: string }[];
    expect(list.map((s) => s.title)).toEqual(["Amazing Grace"]);

    res = await api(`/api/v1/songs/${created.id}`, {}, adminToken);
    expect((await res.json()) as { title: string }).toMatchObject({ title: "Amazing Grace" });
  });

  it("guest tokens are session-scoped", async () => {
    const session = {
      id: "sess-1",
      serviceId: null,
      name: "Main",
      status: "live",
      position: { sessionId: "sess-1", serviceItemId: null, songId: null, arrangementId: null, sectionId: null, sectionInstanceId: null, positionWithinSection: 0 },
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    await api("/api/v1/sessions/sess-1", { method: "PUT", body: JSON.stringify(session) }, adminToken);

    const res = await api("/api/v1/auth/guest", {
      method: "POST",
      body: JSON.stringify({ sessionId: "sess-1", ttlSeconds: 3600 }),
    }, adminToken);
    const { token: guest } = (await res.json()) as { token: string };

    // guest can read its own session
    expect((await api("/api/v1/sessions/sess-1", {}, guest)).status).toBe(200);
    // but not another session's id
    expect((await api("/api/v1/sessions/sess-2", {}, guest)).status).toBe(403);
    // and not admin endpoints
    expect((await api("/api/v1/songs", { method: "POST", body: "{}" }, guest)).status).toBe(403);
  });

  it("WS subscribers receive position broadcasts", async () => {
    const res = await api("/api/v1/auth/guest", {
      method: "POST",
      body: JSON.stringify({ sessionId: "sess-1" }),
    }, adminToken);
    const { token } = (await res.json()) as { token: string };

    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const messages: unknown[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString())));
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "subscribe", sessionId: "sess-1" }));
    await new Promise((r) => setTimeout(r, 50));

    const position = { serviceItemId: null, songId: "song-1", arrangementId: null, sectionId: "sec-1", sectionInstanceId: "ai-1", positionWithinSection: 2 };
    await api("/api/v1/sessions/sess-1/position", { method: "POST", body: JSON.stringify(position) }, adminToken);
    await new Promise((r) => setTimeout(r, 50));

    const broadcast = messages.find((m) => (m as { type: string }).type === "position") as {
      position: { sectionInstanceId: string; positionWithinSection: number };
    };
    expect(broadcast.position.sectionInstanceId).toBe("ai-1");
    expect(broadcast.position.positionWithinSection).toBe(2);
    ws.close();
  });

  it("guest WS cannot subscribe to another session", async () => {
    const res = await api("/api/v1/auth/guest", {
      method: "POST",
      body: JSON.stringify({ sessionId: "sess-1" }),
    }, adminToken);
    const { token } = (await res.json()) as { token: string };
    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const messages: { type: string; code?: string }[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString())));
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "subscribe", sessionId: "sess-99" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.some((m) => m.type === "error" && m.code === "forbidden")).toBe(true);
    ws.close();
  });

  it("rejects WS without a token", async () => {
    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((resolve) => ws.on("error", (e) => resolve((e as Error & { message: string }).message.includes("401") ? 401 : 0)));
    expect(code).toBe(401);
  });

  it("LAN toggle reports addresses", async () => {
    let res = await api("/api/v1/server/network", {}, adminToken);
    expect((await res.json()) as { lanEnabled: boolean }).toMatchObject({ lanEnabled: false });
    res = await api("/api/v1/server/network", {
      method: "POST",
      body: JSON.stringify({ lanEnabled: true }),
    }, adminToken);
    const body = (await res.json()) as { lanEnabled: boolean; addresses: string[] };
    expect(body.lanEnabled).toBe(true);
    expect(body.addresses.length).toBeGreaterThan(0);
    // persists in settings
    expect(app.storage.getSetting("server.lanEnabled")).toBe("true");
  });
});
