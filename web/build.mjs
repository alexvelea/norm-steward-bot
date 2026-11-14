// Bundles the dashboard into web/dist. `--watch` rebuilds on change.
// Code splitting keeps the dev-only mock world (web/src/dev) in its own chunk, fetched only with ?mock=1.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const serve = process.argv.includes("--serve");
const watch = serve || process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, "index.html"), join(dist, "index.html"));

const options = {
  entryPoints: { app: join(here, "src/main.tsx") },
  bundle: true,
  splitting: true,
  outdir: dist,
  chunkNames: "chunks/[name]-[hash]",
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: !watch,
  sourcemap: true,
  loader: { ".css": "css" },
  define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"' },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  if (serve) {
    const { startUiServer } = await import("../scripts/serve.mjs");
    await startUiServer();
  }
} else {
  await esbuild.build(options);
}
