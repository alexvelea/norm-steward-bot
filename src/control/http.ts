import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Controller } from "./controller.js";

export class ControlHttp {
  private sessions = new Map<string, number>();
  private attempts = new Map<string, { at: number; count: number }>();
  constructor(readonly controller: Controller) {}
  private equal(a: string, b: string): boolean {
    return timingSafeEqual(
      createHash("sha256").update(a).digest(),
      createHash("sha256").update(b).digest(),
    );
  }
  authorized(req: IncomingMessage): boolean {
    const cookie = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("steward_session="))
      ?.slice("steward_session=".length);
    return !!cookie && (this.sessions.get(cookie) ?? 0) > Date.now();
  }
  sameOrigin(req: IncomingMessage): boolean {
    if (!req.headers.origin) return true;
    try {
      return new URL(req.headers.origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  private reply(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method !== "GET" && !this.sameOrigin(req)) {
      this.reply(res, 403, {
        error: "Cross-origin control requests are refused.",
      });
      return;
    }
    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 8192) throw new Error("Too large");
          chunks.push(Buffer.from(chunk));
        }
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (!body || Array.isArray(body) || typeof body !== "object")
          throw new Error("Invalid body");
      } catch {
        this.reply(res, 400, {
          error: "Expected a JSON object (maximum 8 KB).",
        });
        return;
      }
    }
    if (path === "/control/session" && req.method === "POST") {
      const ip = req.socket.remoteAddress ?? "local";
      const now = Date.now();
      let limit = this.attempts.get(ip);
      if (!limit || now - limit.at > 60000) {
        limit = { at: now, count: 0 };
        this.attempts.set(ip, limit);
      }
      if (++limit.count > 10) {
        this.reply(res, 429, {
          error: "Too many sign-in attempts; wait a minute.",
        });
        return;
      }
      const configured = this.controller.settings.apiKey;
      if (!configured) {
        this.reply(res, 503, {
          error:
            "Bootstrap the owner key with STEWARD_KEY_FILE before starting the service.",
        });
        return;
      }
      if (
        typeof body.apiKey !== "string" ||
        !this.equal(body.apiKey, configured)
      ) {
        this.reply(res, 401, {
          error: "The key does not match this personal control center.",
        });
        return;
      }
      const token = randomBytes(32).toString("hex");
      this.sessions.set(token, Date.now() + 86400000);
      if (this.sessions.size > 100)
        this.sessions.delete(this.sessions.keys().next().value!);
      const secure =
        req.headers["x-forwarded-proto"] === "https" ||
        req.headers.origin?.startsWith("https:");
      res.setHeader(
        "Set-Cookie",
        `steward_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? "; Secure" : ""}`,
      );
      this.reply(res, 200, this.controller.snapshot());
      return;
    }
    if (!this.authorized(req)) {
      this.reply(res, 401, {
        error: "Sign in with your configured player key.",
      });
      return;
    }
    try {
      if (path === "/control/state" && req.method === "GET") {
        this.reply(res, 200, this.controller.snapshot());
        return;
      }
      if (path === "/control/key" && req.method === "POST") {
        this.reply(res, 200, { apiKey: this.controller.settings.apiKey });
        return;
      }
      if (path === "/control/logout" && req.method === "POST") {
        const cookie = (req.headers.cookie ?? "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("steward_session="))
          ?.slice(16);
        if (cookie) this.sessions.delete(cookie);
        res.setHeader(
          "Set-Cookie",
          "steward_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        this.reply(res, 200, { ok: true });
        return;
      }
      if (path === "/control/settings" && req.method === "PUT") {
        if (
          typeof body.serverUrl !== "string" ||
          typeof body.worldId !== "string" ||
          (body.apiKey !== undefined && typeof body.apiKey !== "string")
        )
          throw new Error(
            "Server URL and world are required strings; key is optional.",
          );
        await this.controller.configure({
          serverUrl: body.serverUrl,
          worldId: body.worldId,
          ...(typeof body.apiKey === "string" && body.apiKey
            ? { apiKey: body.apiKey }
            : {}),
        });
        this.reply(res, 200, this.controller.snapshot());
        return;
      }
      if (path === "/control/automatic" && req.method === "PUT") {
        if (typeof body.enabled !== "boolean")
          throw new Error("enabled must be a boolean.");
        await this.controller.setAutomatic(body.enabled);
        this.reply(res, 200, this.controller.snapshot());
        return;
      }
      if (path === "/control/pending/resolve" && req.method === "POST") {
        await this.controller.resolveUncertain(body.acknowledged === true);
        this.reply(res, 200, this.controller.snapshot());
        return;
      }
      if (path === "/control/evaluate" && req.method === "POST") {
        await this.controller.cycle();
        this.reply(res, 200, this.controller.snapshot());
        return;
      }
      this.reply(res, 404, { error: "No such control endpoint." });
    } catch (e) {
      this.reply(res, 400, {
        error: e instanceof Error ? e.message : "Control operation failed.",
      });
    }
  }
}
