import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { outreachApiPlugin } from "./src/outreach/vite-plugin";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // outreachApiPlugin serves the review dashboard's JSON API at /api/outreach/ (dev + preview).
  plugins: [react(), tailwindcss(), outreachApiPlugin()],
  server: {
    // The outreach store (leads, drafts, rendered media) changes while the pipeline runs; it is data, not source.
    watch: { ignored: [path.join(root, "outreach", "**")] },
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/*.spec.ts", "node_modules", "dist", "artifacts"],
  },
});
