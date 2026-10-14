import { createServer, type IncomingMessage } from "node:http";
import type { DemoChannel } from "@/contracts";
import { runDemoJob, setLeadStatus } from "./core";

/**
 * Webhook API so other agents can call the demo bot: a Keiki agent on WhatsApp or iMessage, a Zap,
 * or a teammate's Claude/Codex session. Every request needs `Authorization: Bearer $BOT_API_TOKEN`.
 *   POST /v1/demos  { url, channel?, video? }  → { name, channel, story, link, mp4Url?, draft }   (takes 1–3 min)
 *   POST /v1/leads/:id/status { status: "approved"|"skipped"|"sent" }
 *   GET  /health
 */
const CHANNELS = new Set<DemoChannel>(["imessage", "sms", "whatsapp", "telegram", "slack"]);

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function startHttp(port: number): void {
  const token = process.env.BOT_API_TOKEN;
  if (!token) throw new Error("BOT_API_TOKEN is required for the webhook API");
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") return send(200, { ok: true });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
    try {
      if (req.method === "POST" && url.pathname === "/v1/demos") {
        const body = await readBody(req);
        if (typeof body.url !== "string") return send(400, { error: "url is required" });
        const channel = typeof body.channel === "string" && CHANNELS.has(body.channel as DemoChannel) ? (body.channel as DemoChannel) : undefined;
        const result = await runDemoJob({ url: body.url, channel, video: body.video !== false });
        return send(200, {
          leadId: result.leadId,
          name: result.profile.name,
          summary: result.profile.summary,
          channel: result.channel,
          story: result.story,
          link: result.link,
          mp4Url: result.mp4Url,
          renderError: result.renderError,
          draft: result.draft,
        });
      }
      const status = url.pathname.match(/^\/v1\/leads\/([^/]+)\/status$/);
      if (req.method === "POST" && status) {
        const body = await readBody(req);
        if (body.status !== "approved" && body.status !== "skipped" && body.status !== "sent") return send(400, { error: "status must be approved, skipped or sent" });
        const lead = setLeadStatus(decodeURIComponent(status[1]), body.status);
        return lead ? send(200, { id: lead.id, status: lead.status }) : send(404, { error: "no such lead" });
      }
      return send(404, { error: "not found" });
    } catch (error) {
      return send(500, { error: (error as Error).message });
    }
  });
  server.requestTimeout = 0;
  server.listen(port, () => console.log(`http: listening on :${port}`));
}
