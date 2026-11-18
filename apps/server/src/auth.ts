import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SqliteStorage } from "@praisesuite/storage-sqlite";

export interface TokenPayload {
  /** "admin" | "guest" */
  sub: "admin" | "guest";
  /** Session scope for guest tokens (TAS 13.3). */
  sessionId: string | null;
  scopes: string[];
  /** Issued-at / expiry (unix seconds). */
  iat: number;
  exp: number;
  /** Token id — revocable handle. */
  jti: string;
}

const TOKEN_PREFIX = "v1";

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Token + password management backed by the settings table.
 * Tokens are HMAC-signed compact strings (`v1.<payload>.<sig>`); guest
 * tokens carry a session scope and expiry per TAS 13.3.
 */
export class AuthService {
  private readonly revoked = new Set<string>();

  constructor(private readonly storage: SqliteStorage) {}

  private secret(): string {
    let s = this.storage.getSetting("server.secret");
    if (s === null) {
      s = randomBytes(32).toString("hex");
      this.storage.setSetting("server.secret", s);
    }
    return s;
  }

  get adminPasswordSet(): boolean {
    return this.storage.getSetting("admin.passwordHash") !== null;
  }

  setAdminPassword(password: string): void {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    this.storage.setSetting("admin.passwordHash", `scrypt$${salt}$${hash}`);
  }

  verifyAdminPassword(password: string): boolean {
    const stored = this.storage.getSetting("admin.passwordHash");
    if (stored === null) return false;
    const [algo, salt, hash] = stored.split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  issue(payload: Omit<TokenPayload, "iat" | "exp" | "jti">, ttlSeconds = 60 * 60 * 12): string {
    const now = Math.floor(Date.now() / 1000);
    const full: TokenPayload = {
      ...payload,
      iat: now,
      exp: now + ttlSeconds,
      jti: randomBytes(12).toString("base64url"),
    };
    const body = b64url(JSON.stringify(full));
    return `${TOKEN_PREFIX}.${body}.${sign(body, this.secret())}`;
  }

  verify(token: string): TokenPayload | null {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
    const [body, sigB64] = [parts[1]!, parts[2]!];
    const expected = sign(body, this.secret());
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    } catch {
      return null;
    }
    if (this.revoked.has(payload.jti)) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  revoke(jti: string): void {
    this.revoked.add(jti);
  }
}

export function tokenFromRequest(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}
