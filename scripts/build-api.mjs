// Bundles the studio's serverless function into api/make.mjs (Vercel picks up /api at deploy time).
// The source uses the "@/" alias, which Vercel's per-file TypeScript build does not resolve, so we bundle it.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const [entry, out] of [["src/studio/api-entry.ts", "api/make.mjs"], ["src/studio/share-entry.ts", "api/share.mjs"]]) await build({
  entryPoints: [path.join(root, entry)],
  outfile: path.join(root, out),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: { "@": path.join(root, "src") },
  external: ["@playwright/test", "playwright", "playwright-core"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("built api/make.mjs, api/share.mjs");
