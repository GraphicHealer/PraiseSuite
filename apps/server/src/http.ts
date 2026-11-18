import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService, TokenPayload } from "./auth.js";
import { tokenFromRequest } from "./auth.js";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Verified token payload when the endpoint requires auth. */
  auth: TokenPayload | null;
  body(): Promise<unknown>;
}

export type RouteAccess = "public" | "guest" | "admin";

export interface Route {
  method: string;
  /** Path template, e.g. "/api/v1/songs/:id". */
  path: string;
  access: RouteAccess;
  summary: string;
  handler(ctx: RouteContext): Promise<unknown>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function matchPath(template: string, actual: string): Record<string, string> | null {
  const t = template.split("/").filter(Boolean);
  const a = actual.split("/").filter(Boolean);
  if (t.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i++) {
    if (t[i]!.startsWith(":")) params[t[i]!.slice(1)] = decodeURIComponent(a[i]!);
    else if (t[i] !== a[i]) return null;
  }
  return params;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  send(res, status, { error: { code, message } });
}

/**
 * Local trust: when LAN access is disabled the server only listens on
 * localhost, so requests are treated as the local admin — no token needed.
 * Enabling LAN re-arms token auth (TAS 15.3).
 */
const LOCAL_ADMIN: TokenPayload = { sub: "admin", jti: "local", scopes: [], sessionId: null, iat: 0, exp: 0 };

export function dispatch(routes: Route[], authService: AuthService, isOpenLocal: () => boolean = () => false) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization,content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (params === null) continue;

      const token = tokenFromRequest(req.headers.authorization) ?? url.searchParams.get("token");
      const auth = (token ? authService.verify(token) : null) ?? (isOpenLocal() ? LOCAL_ADMIN : null);
      if (route.access !== "public" && auth === null) {
        sendError(res, 401, "unauthorized", "Valid bearer token required");
        return;
      }
      if (route.access === "admin" && auth?.sub !== "admin") {
        sendError(res, 403, "forbidden", "Administrator access required");
        return;
      }

      try {
        const ctx: RouteContext = {
          req,
          res,
          params,
          query: url.searchParams,
          auth,
          body: () => readBody(req),
        };
        const result = await route.handler(ctx);
        if (!res.writableEnded) send(res, 200, result ?? { ok: true });
      } catch (e) {
        if (e instanceof ApiError) sendError(res, e.status, e.code, e.message);
        else {
          sendError(res, 500, "internal", (e as Error).message);
        }
      }
      return;
    }
    sendError(res, 404, "not_found", "No such endpoint");
  };
}
