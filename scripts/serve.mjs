// Static dashboard hosting and transport proxy only. The remote server owns all game state.
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import httpProxy from "http-proxy";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const isApi = (url = "/") => /^\/(?:api\/v1|mcp)(?:[/?]|$)/.test(url);

export function createUiServer({ root = resolve(project, "web/dist"), upstream = process.env.STEWARD_URL || "https://norn-steward.velea.cc" } = {}) {
  const target = new URL(upstream);
  if (!["http:", "https:"].includes(target.protocol) || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("STEWARD_URL must be an HTTP(S) origin, without a path or query.");
  }
  const proxy = httpProxy.createProxyServer({ target: target.origin, changeOrigin: true, ws: true, secure: true });
  proxy.on("error", (_error, _request, response) => {
    // Never log request headers: they may contain the player's API key.
    if (typeof response.writeHead === "function") {
      if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "The game server can't be reached." } }));
    } else response.destroy();
  });
  const server = createServer(async (request, response) => {
    if (isApi(request.url)) return proxy.web(request, response);
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
      response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end("Dashboard files not found. Run npm run build:web first.");
    }
  });
  server.on("upgrade", (request, socket, head) => {
    if (isApi(request.url)) proxy.ws(request, socket, head);
    else socket.destroy();
  });
  server.on("close", () => proxy.close());
  return server;
}

export async function startUiServer() {
  const server = createUiServer();
  const port = Number(process.env.PORT || 8788);
  const host = process.env.HOST || "127.0.0.1";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`Dashboard: http://${host}:${port}`);
  console.log(`Game server: ${process.env.STEWARD_URL || "https://norn-steward.velea.cc"}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startUiServer();
}
