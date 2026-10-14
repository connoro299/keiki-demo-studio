import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Mounts the outreach review API (src/outreach/api.ts) at /api/outreach/ on `vite` and
 * `vite preview`. vite.config.ts is bundled without the "@/" alias, so this file uses no aliased
 * imports and loads the API through Vite's SSR loader (dev) or tsx (preview), both of which
 * resolve "@/". Dev picks up edits to the API without a restart.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
type ApiModule = { createOutreachApi: () => Handler };

const PREFIX = "/api/outreach/";

function middleware(load: () => Promise<Handler>) {
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    if (!req.url?.startsWith(PREFIX)) return next();
    load()
      .then((handle) => handle(req, res))
      .then((handled) => {
        if (!handled) next();
      })
      .catch((error: Error) => {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: `outreach API failed to load: ${error.message}` }));
      });
  };
}

/** Dev-only bridge for the studio's Vercel function (src/studio/server.ts) at POST /api/make. */
function studioMiddleware(load: () => Promise<(request: Request) => Promise<Response>>) {
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    if (!req.url?.startsWith("/api/make") && !req.url?.startsWith("/api/share")) return next();
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const handle = await load();
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
        const response = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        if (!response.body) return res.end();
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ type: "error", code: "failed", message: (error as Error).message }));
      }
    });
  };
}

export function outreachApiPlugin(): Plugin {
  // Server-side studio code reads ANTHROPIC_API_KEY / BLOB_READ_WRITE_TOKEN from process.env.
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: the studio shows its "not switched on" notice.
  }
  return {
    name: "keiki-outreach-api",
    configureServer(server) {
      server.middlewares.use(
        studioMiddleware(async () => {
          const make = (await server.ssrLoadModule("/src/studio/server.ts")) as { handleMake: (request: Request) => Promise<Response> };
          const share = (await server.ssrLoadModule("/src/studio/share-server.ts")) as { handleShare: (request: Request) => Promise<Response> };
          return (request: Request) => (new URL(request.url).pathname.startsWith("/api/share") ? share.handleShare(request) : make.handleMake(request));
        }),
      );
      server.middlewares.use(
        middleware(async () => {
          const mod = (await server.ssrLoadModule("/src/outreach/api.ts")) as ApiModule;
          return mod.createOutreachApi();
        }),
      );
    },
    configurePreviewServer(server) {
      let handler: Promise<Handler> | undefined;
      server.middlewares.use(
        middleware(() => {
          handler ??= import("tsx/esm/api").then(async ({ tsImport }) => {
            const mod = (await tsImport("./api.ts", import.meta.url)) as ApiModule;
            return mod.createOutreachApi();
          });
          return handler;
        }),
      );
    },
  };
}
