// Static dashboard hosting and transport proxy only. The remote server owns all game state.
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import httpProxy from "http-proxy";
import { WebSocket, WebSocketServer } from "ws";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const isApi = (url = "/") => /^\/(?:api\/v1|mcp)(?:[/?]|$)/.test(url);

export function createUiServer({
  control,
  access,
  root = resolve(project, "web/dist"),
  upstream = process.env.STEWARD_URL || "https://norn-steward.velea.cc",
} = {}) {
  const target = new URL(upstream);
  if (!["http:", "https:"].includes(target.protocol) || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("STEWARD_URL must be an HTTP(S) origin, without a path or query.");
  }
  const proxy = httpProxy.createProxyServer({ target: target.origin, changeOrigin: true, ws: true, secure: true });
  proxy.on("error", (_error, _request, response) => {
    // Never log request headers: they may contain the player's API key.
    if (typeof response.writeHead === "function") {
      if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "The game server can't be reached." } }),
      );
    } else response.destroy();
  });
  const server = createServer(async (request, response) => {
    if (access && (await access.handle(request, response))) return;
    if (request.url?.startsWith("/control/")) {
      if (!control) {
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Control service is not running." }));
      }
      return control.handle(request, response);
    }
    if (isApi(request.url)) {
      if (control && (!control.authorized(request) || (request.method !== "GET" && !control.sameOrigin(request)))) {
        response.writeHead(401);
        return response.end("Sign in to the control center first.");
      }
      if (control) request.headers.authorization = `Bearer ${control.controller.settings.apiKey}`;
      return proxy.web(request, response, { target: control?.controller.settings.serverUrl || target.origin });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      return response.end();
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const base = await realpath(root);
      let file = resolve(base, `.${pathname}`);
      if (file !== base && !file.startsWith(base + sep)) {
        response.writeHead(403);
        return response.end();
      }
      try {
        if (!(await stat(file)).isFile()) file = resolve(base, "index.html");
      } catch {
        if (extname(pathname)) {
          response.writeHead(404);
          return response.end("Not found");
        }
        file = resolve(base, "index.html");
      }
      file = await realpath(file);
      if (!file.startsWith(base + sep)) {
        response.writeHead(403);
        return response.end();
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end("Dashboard files not found. Run npm run build:web first.");
    }
  });
  const bridges = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (access && !access.authorized(request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!isApi(request.url) || (control && !control.authorized(request))) {
      socket.destroy();
      return;
    }
    if (!control) {
      proxy.ws(request, socket, head);
      return;
    }
    if (!control.sameOrigin(request)) {
      socket.destroy();
      return;
    }
    bridges.handleUpgrade(request, socket, head, (client) => {
      const settings = control.controller.settings;
      const destination = new URL(request.url, settings.serverUrl);
      destination.protocol = destination.protocol === "https:" ? "wss:" : "ws:";
      const upstreamSocket = new WebSocket(destination);
      const queue = [];
      let helloSeen = false;
      const forward = (payload) => {
        if (access && !access.authorized(request)) {
          client.close(1008);
          upstreamSocket.terminate();
          return;
        }
        let data = payload.toString();
        if (!helloSeen) {
          helloSeen = true;
          try {
            const hello = JSON.parse(data);
            if (hello.type === "hello") {
              hello.key = settings.apiKey;
              data = JSON.stringify(hello);
            }
          } catch {}
        }
        if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data);
        else if (queue.length < 4) queue.push(data);
        else client.close(1008);
      };
      client.on("message", forward);
      upstreamSocket.on("open", () => {
        for (const data of queue) upstreamSocket.send(data);
        queue.length = 0;
      });
      upstreamSocket.on("message", (data) => {
        if (access && !access.authorized(request)) {
          client.close(1008);
          upstreamSocket.terminate();
          return;
        }
        if (client.readyState === WebSocket.OPEN) client.send(data.toString());
      });
      upstreamSocket.on("error", () => client.close(1011));
      client.on("error", () => upstreamSocket.terminate());
      client.on("close", () => upstreamSocket.terminate());
      upstreamSocket.on("close", (code) => {
        if (client.readyState === WebSocket.OPEN)
          client.close(
            (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999)
              ? code
              : 1011,
          );
      });
    });
  });
  server.on("control-shutdown", () => {
    for (const client of bridges.clients) client.terminate();
  });
  server.on("close", () => {
    for (const client of bridges.clients) client.terminate();
    bridges.close();
    proxy.close();
  });
  return server;
}

export async function startUiServer() {
  const { Controller, acquireExecutorLease } = await import("../src/control/controller.ts");
  const { FileControlStorage } = await import("../src/control/storage.ts");
  const { ControlHttp } = await import("../src/control/http.ts");
  const { SiteAccess } = await import("../src/control/access.ts");
  const dataDir = resolve(process.env.STEWARD_CONTROL_DIR || resolve(project, "data/control"));
  const digestFile = resolve(process.env.STEWARD_ACCESS_TOKEN_HASH_FILE || resolve(dataDir, "access-token.sha256"));
  let siteAccess;
  try {
    siteAccess = new SiteAccess((await readFile(digestFile, "utf8")).trim());
  } catch {
    throw new Error(
      "Site access token is not initialized. Run npm run access:init with the configured STEWARD_CONTROL_DIR first.",
    );
  }
  const initialKey = process.env.STEWARD_KEY_FILE
    ? (await readFile(process.env.STEWARD_KEY_FILE, "utf8")).trim()
    : process.env.STEWARD_KEY || "";
  const lease = await acquireExecutorLease(Number(process.env.STEWARD_EXECUTOR_PORT || 8790));
  let controller;
  try {
    controller = await Controller.create(new FileControlStorage(dataDir), {
      serverUrl: process.env.STEWARD_URL || "https://norn-steward.velea.cc",
      worldId: process.env.STEWARD_WORLD || "blitz-1",
      apiKey: initialKey,
    });
  } catch (error) {
    await new Promise((resolve) => lease.close(resolve));
    throw error;
  }
  const control = new ControlHttp(controller);
  const server = createUiServer({ control, access: siteAccess });
  const port = Number(process.env.PORT || 8788);
  const host = process.env.HOST || "127.0.0.1";
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    server.emit("control-shutdown");
    await new Promise((resolve) => lease.close(resolve));
    throw error;
  }
  controller.start();
  let stopping;
  const stop = () => {
    if (stopping) return;
    stopping = (async () => {
      await controller.stop();
      server.emit("control-shutdown");
      server.closeAllConnections();
      server.close(() => lease.close(() => process.exit(0)));
    })();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log(`Dashboard: http://${host}:${port}`);
  console.log(`Game server: ${process.env.STEWARD_URL || "https://norn-steward.velea.cc"}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startUiServer();
}
