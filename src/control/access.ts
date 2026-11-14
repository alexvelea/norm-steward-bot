import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const COOKIE = "steward_access";
const SESSION_MS = 7 * 86400000;
/** Outer, token-only gate. Only the SHA-256 digest of a high-entropy token is loaded by the service. */
export class SiteAccess {
  private sessions = new Map<string, number>();
  private failed = { since: 0, count: 0 };
  constructor(
    private readonly tokenHash: string,
    private readonly now = Date.now,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(tokenHash)) throw new Error("Invalid site access digest; run npm run access:init.");
  }
  private cookie(req: IncomingMessage): string | undefined {
    return (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1);
  }
  authorized(req: IncomingMessage): boolean {
    const token = this.cookie(req);
    return !!token && (this.sessions.get(token) ?? 0) > this.now();
  }
  private sameOrigin(req: IncomingMessage): boolean {
    if (!req.headers.origin) return true;
    try {
      return new URL(req.headers.origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  private secure(req: IncomingMessage): string {
    return req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  }
  private headers(res: ServerResponse): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
  private loginPage(res: ServerResponse, status = 200, message = ""): void {
    this.headers(res);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    res.writeHead(status);
    // No interpolated request data or credentials: message is a server-owned constant.
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private access · Steward Control</title><style>
      :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 20% 0,#34302066,transparent 60%),#0e0c09;color:#efe4cc;font:14px system-ui,sans-serif}main{width:min(440px,calc(100% - 32px));padding:34px;border:1px solid #d4a24c44;border-radius:12px;background:#1c1811}small{color:#d4a24c;text-transform:uppercase;letter-spacing:.18em;font-size:10px}h1{font-family:Georgia,serif;font-size:30px;font-weight:500;margin:12px 0 16px}p{color:#a99b80;line-height:1.6}label{display:block;margin:24px 0 8px;color:#c2b394;font-size:12px}input,button{width:100%;border-radius:6px;font:inherit}input{padding:12px;background:#0e0c09;border:1px solid #d4a24c44;color:#efe4cc}input:focus{outline:2px solid #d4a24c;outline-offset:2px}button{margin-top:16px;padding:12px;border:0;color:#221807;background:linear-gradient(#edc56d,#b88731);font-weight:600;cursor:pointer}.error{color:#e9826a;font-size:12px}.note{font-size:11px;margin:20px 0 0}
      </style></head><body><main><small>Personal control center</small><h1>Private access</h1><p>Enter your site access token to continue.</p><form action="/access/login" method="post"><label for="token">Access token</label><input id="token" name="token" type="password" autocomplete="current-password" spellcheck="false" maxlength="512" required autofocus><button type="submit">Unlock site</button></form>${message ? `<p class="error" role="alert">${message}</p>` : ""}<p class="note">No username needed. This token is separate from the game API key.</p></main></body></html>`);
  }
  /** Returns true when this gate consumed the request; false permits the existing app to handle it. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/access/login" && req.method === "GET") {
      if (this.authorized(req)) {
        res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
        res.end();
      } else this.loginPage(res);
      return true;
    }
    if ((path === "/access/login" || path === "/access/logout") && req.method === "POST") {
      this.headers(res);
      if (!this.sameOrigin(req)) {
        res.writeHead(403);
        res.end("Cross-origin sign-in requests are refused.");
        return true;
      }
      if (path === "/access/logout") {
        const session = this.cookie(req);
        if (session) this.sessions.delete(session);
        res.setHeader("Set-Cookie", [
          `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${this.secure(req)}`,
          `steward_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${this.secure(req)}`,
        ]);
        res.writeHead(303, { Location: "/access/login" });
        res.end();
        return true;
      }
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 2048) throw new Error("Too large");
        }
      } catch {
        res.writeHead(413);
        res.end("Sign-in request is too large.");
        return true;
      }
      const token = new URLSearchParams(body).get("token")?.trim() ?? "";
      const digest = createHash("sha256").update(token).digest();
      if (!token || !timingSafeEqual(digest, Buffer.from(this.tokenHash, "hex"))) {
        const now = this.now();
        if (now - this.failed.since >= 60000) this.failed = { since: now, count: 0 };
        this.failed.count++;
        if (this.failed.count > 10) {
          res.setHeader("Retry-After", "60");
          this.loginPage(res, 429, "Too many attempts. Wait a minute before trying again.");
        } else this.loginPage(res, 401, "That access token is not valid.");
        return true;
      }
      const session = randomBytes(32).toString("hex");
      this.sessions.set(session, this.now() + SESSION_MS);
      if (this.sessions.size > 100) this.sessions.delete(this.sessions.keys().next().value!);
      res.setHeader(
        "Set-Cookie",
        `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${this.secure(req)}`,
      );
      res.writeHead(303, { Location: "/" });
      res.end();
      return true;
    }
    if (this.authorized(req)) return false;
    this.headers(res);
    if (
      req.method === "GET" &&
      (req.headers.accept?.includes("text/html") || path === "/" || path === "/settings" || path.startsWith("/w/"))
    ) {
      res.writeHead(303, { Location: "/access/login" });
      res.end();
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Site access token required." }));
    }
    return true;
  }
}
