import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createApp, type PraiseSuiteApp } from "../src/app.js";

let app: PraiseSuiteApp;
let dir: string;
let base: string;
let adminToken = "";
const fixtures = resolve(process.cwd(), "../../infrastructure/fixtures/opensong-defaults");

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

  it("songs CRUD (local mode trusts localhost)", async () => {
    // LAN off → no token needed: localhost requests are treated as admin.
    let res = await api("/api/v1/songs");
    expect(res.status).toBe(200);

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

  it("print endpoints serve HTML documents", async () => {
    let res = await api("/api/v1/songs", {
      method: "POST",
      body: JSON.stringify({ title: "Printable Song", authors: ["Author A"] }),
    });
    const created = (await res.json()) as { id: string };

    res = await api(`/api/v1/print/song/${created.id}?mode=chord`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Printable Song");

    res = await api(`/api/v1/print/song/${created.id}?mode=lyrics`);
    expect(res.status).toBe(200);

    res = await api("/api/v1/print/songbook");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Printable Song");
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
      blanked: false,
      mode: "normal",
      alert: null,
      controlOwner: null,
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

  it("accepts tokenless WS in local mode (LAN off)", async () => {
    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const hello = await new Promise<string>((resolve) => ws.on("message", (d) => resolve(d.toString())));
    expect(JSON.parse(hello)).toMatchObject({ type: "hello" });
    ws.close();
  });

  it("navigate/blank/control flow over a real service plan", async () => {
    // Seed a song + service bound to a session.
    const songRes = await api("/api/v1/songs", {
      method: "POST",
      body: JSON.stringify({ title: "Nav Song" }),
    }, adminToken);
    const song = (await songRes.json()) as { id: string };

    const service = {
      id: "svc-1",
      revision: { id: "r1", parentId: null, origin: "test", createdAt: new Date().toISOString() },
      name: "Nav Service", date: null, description: null,
      items: [
        { id: "i1", kind: "song", songId: song.id, arrangementId: null, mediaAssetId: null, title: "Nav Song", subtitle: null, notes: null, slides: [], loopSeconds: 0, config: {} },
      ],
    };
    await api("/api/v1/services/svc-1", { method: "PUT", body: JSON.stringify(service) }, adminToken);

    const session = {
      id: "sess-nav",
      serviceId: "svc-1", name: "Nav", status: "live",
      position: { sessionId: "sess-nav", serviceItemId: null, songId: null, arrangementId: null, sectionId: null, sectionInstanceId: null, positionWithinSection: 0 },
      blanked: false, mode: "normal", alert: null, controlOwner: null,
      createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
    };
    await api("/api/v1/sessions/sess-nav", { method: "PUT", body: JSON.stringify(session) }, adminToken);

    // Song has no sections → plan has one fallback slide (item.slides empty → title slide).
    let res = await api("/api/v1/sessions/sess-nav/navigate", {
      method: "POST", body: JSON.stringify({ action: "next" }),
    }, adminToken);
    expect(res.status).toBe(200);

    res = await api("/api/v1/sessions/sess-nav/blank", {
      method: "POST", body: JSON.stringify({ blanked: true }),
    }, adminToken);
    expect((await res.json()) as { blanked: boolean }).toMatchObject({ blanked: true });

    const slideRes = await api("/api/v1/sessions/sess-nav/slide", {}, adminToken);
    const slideBody = (await slideRes.json()) as { blanked: boolean; slide: { title: string } | null };
    expect(slideBody.blanked).toBe(true);
    expect(slideBody.slide?.title).toBe("Nav Song");

    // Control ownership: guest with "control" scope can take; others blocked.
    const guestRes = await api("/api/v1/auth/guest", {
      method: "POST", body: JSON.stringify({ sessionId: "sess-nav", scopes: ["control"] }),
    }, adminToken);
    const { token: g } = (await guestRes.json()) as { token: string };
    res = await api("/api/v1/sessions/sess-nav/control", { method: "POST", body: JSON.stringify({ take: true }) }, g);
    expect(res.status).toBe(200);

    const guest2Res = await api("/api/v1/auth/guest", {
      method: "POST", body: JSON.stringify({ sessionId: "sess-nav", scopes: ["control"] }),
    }, adminToken);
    const { token: g2 } = (await guest2Res.json()) as { token: string };
    res = await api("/api/v1/sessions/sess-nav/navigate", { method: "POST", body: JSON.stringify({ action: "next" }) }, g2);
    expect(res.status).toBe(409); // control held by g

    // view-scoped guest can't navigate at all
    const viewRes = await api("/api/v1/auth/guest", {
      method: "POST", body: JSON.stringify({ sessionId: "sess-nav", scopes: ["view"] }),
    }, adminToken);
    const { token: gv } = (await viewRes.json()) as { token: string };
    res = await api("/api/v1/sessions/sess-nav/navigate", { method: "POST", body: JSON.stringify({ action: "next" }) }, gv);
    expect(res.status).toBe(403);
  });

  it("receiver join mints a view-scoped token for the live session", async () => {
    const res = await api("/api/v1/receiver/join");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { sessionId: string; token: string };
    expect(j.sessionId).toBe("sess-nav"); // most recently active live session
    // token works for the slide endpoint
    const slide = await api(`/api/v1/sessions/${j.sessionId}/slide`, {}, j.token);
    expect(slide.status).toBe(200);
    // but not for library browsing
    expect((await api("/api/v1/songs", {}, j.token)).status).toBe(403);
  });

  it("mode and alert endpoints update session state and slide payload", async () => {
    let res = await api("/api/v1/sessions/sess-nav/mode", {
      method: "POST", body: JSON.stringify({ mode: "logo" }),
    }, adminToken);
    expect((await res.json()) as { mode: string }).toMatchObject({ mode: "logo" });

    res = await api("/api/v1/sessions/sess-nav/alert", {
      method: "POST", body: JSON.stringify({ message: "Nursery 12" }),
    }, adminToken);
    expect((await res.json()) as { alert: string }).toMatchObject({ alert: "Nursery 12" });

    const slide = await api("/api/v1/sessions/sess-nav/slide", {}, adminToken);
    const body = (await slide.json()) as {
      mode: string; alert: string;
      slide: { style: { body: { font: string } }; logoKey: string | null; next: unknown } | null;
    };
    expect(body.mode).toBe("logo");
    expect(body.alert).toBe("Nursery 12");
    expect(body.slide?.style.body.font).toBe("Inter"); // resolved default style
    expect(body.slide).toHaveProperty("next");

    // clear
    await api("/api/v1/sessions/sess-nav/mode", { method: "POST", body: JSON.stringify({ mode: "normal" }) }, adminToken);
    await api("/api/v1/sessions/sess-nav/alert", { method: "POST", body: JSON.stringify({ message: null }) }, adminToken);
  });

  it("global style get/put and OpenSong settings import", async () => {
    let res = await api("/api/v1/style", {}, adminToken);
    const style = (await res.json()) as { body: { size: number; font: string }; backgroundColor: string };
    expect(style.body.font).toBe("Inter");

    // PUT a custom style
    style.body.size = 44;
    style.backgroundColor = "#123456";
    res = await api("/api/v1/style", { method: "PUT", body: JSON.stringify(style) }, adminToken);
    expect(((await res.json()) as typeof style).body.size).toBe(44);
    // reflected in slide payload
    const slide = await api("/api/v1/sessions/sess-nav/slide", {}, adminToken);
    const body = (await slide.json()) as { slide: { style: { body: { size: number }; backgroundColor: string } } | null };
    expect(body.slide?.style.body.size).toBe(44);
    expect(body.slide?.style.backgroundColor).toBe("#123456");

    // Import real OpenSong PresentSettings (fonts resolved, media stored)
    const xml = readFileSync(resolve(fixtures, "Settings/PresentSettings"), "utf8");
    res = await api("/api/v1/import/opensong/settings", {
      method: "POST", body: JSON.stringify({ presentSettings: xml }),
    }, adminToken);
    const out = (await res.json()) as { media: string[]; style: { body: { font: string }; logoKey: string | null; backgroundKey: string | null } };
    expect(out.style.body.font).toBe("Inter");
    expect(out.media.length).toBeGreaterThan(0);
    expect(out.style.logoKey).toBeTruthy();

    // Media endpoint serves the imported background to guests
    const file = out.style.backgroundKey!.split("/").pop()!;
    const media = await fetch(`${base}/api/v1/media/${file}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toContain("image/");
  });

  it("bible import + passage endpoint", async () => {
    const xml = `<?xml version="1.0"?><bible biblename="KJV"><b n="43" name="John"><c n="3"><v n="16">For God so loved the world</v><v n="17">For God sent not his Son</v></c></b></bible>`;
    let res = await api("/api/v1/bibles", { method: "POST", body: JSON.stringify({ format: "opensong", xml }) }, adminToken);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };

    res = await api("/api/v1/bibles", {}, adminToken);
    expect((await res.json()) as unknown[]).toHaveLength(1);

    res = await api(`/api/v1/bibles/${id}/passage?ref=${encodeURIComponent("John 3:16-17")}`, {}, adminToken);
    const p = (await res.json()) as { title: string; slides: { body: string }[] };
    expect(p.title).toBe("John 3:16-17 (Bible)");
    expect(p.slides[0]!.body).toContain("16. For God so loved");

    // bad ref + guest-blocked admin route
    expect((await api(`/api/v1/bibles/${id}/passage?ref=xyz`, {}, adminToken)).status).toBe(400);
  });

  it("media upload stores and serves bytes", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    let res = await api("/api/v1/media", {
      method: "POST",
      body: JSON.stringify({ name: "dot.png", mediaType: "image/png", dataBase64: png.toString("base64") }),
    }, adminToken);
    const { storageKey } = (await res.json()) as { storageKey: string };
    expect(storageKey).toMatch(/^media\/[0-9a-f]{64}\.png$/);
    const file = storageKey.split("/").pop()!;
    res = await api(`/api/v1/media/${file}`, {}, adminToken);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
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

    // LAN on → token auth is armed again.
    res = await api("/api/v1/songs");
    expect(res.status).toBe(401);

    // Reset for other tests.
    await api("/api/v1/server/network", { method: "POST", body: JSON.stringify({ lanEnabled: false }) }, adminToken);
    expect((await api("/api/v1/songs")).status).toBe(200);
  });
});
