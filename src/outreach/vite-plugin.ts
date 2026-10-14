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

export function outreachApiPlugin(): Plugin {
  return {
    name: "keiki-outreach-api",
    configureServer(server) {
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
