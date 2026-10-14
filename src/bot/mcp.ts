import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listLeads } from "@/outreach/store";
import { runDemoJob, setLeadStatus } from "./core";

/**
 * MCP server (stdio) so a Claude Code / Codex session on the same machine can make demos as a tool.
 * Add it with: claude mcp add keiki-demos -- npm --prefix <repo> run -s bot:mcp
 */
const server = new McpServer({ name: "keiki-demos", version: "1.0.0" });

server.registerTool(
  "make_demo",
  {
    description: "Read a business's website, write a demo conversation of its Keiki agent, record it as an MP4, and draft an outreach email. Takes 1–3 minutes. Never sends anything.",
    inputSchema: {
      url: z.string().describe("The business's website, e.g. sproutdental.com"),
      channel: z.enum(["imessage", "sms", "whatsapp", "telegram", "slack"]).optional().describe("Messaging app to show. Omit to let the bot pick."),
      video: z.boolean().optional().describe("Record the MP4 (default true)."),
    },
  },
  async ({ url, channel, video }) => {
    const result = await runDemoJob({ url, channel, video });
    const payload = {
      leadId: result.leadId, name: result.profile.name, channel: result.channel, story: result.story,
      link: result.link, mp4: result.mp4, mp4Url: result.mp4Url, renderError: result.renderError, draft: result.draft,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
);

server.registerTool(
  "list_demos",
  { description: "List recent demo leads with status and best contact.", inputSchema: { limit: z.number().int().positive().max(200).optional() } },
  async ({ limit }) => {
    const rows = listLeads().slice(0, limit ?? 25).map((lead) => ({ id: lead.id, url: lead.url, status: lead.status, name: lead.profile?.name, to: lead.draft?.to?.value, subject: lead.draft?.subject }));
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  },
);

server.registerTool(
  "set_demo_status",
  { description: "Mark a demo lead approved, skipped, or sent.", inputSchema: { leadId: z.string(), status: z.enum(["approved", "skipped", "sent"]) } },
  async ({ leadId, status }) => {
    const lead = setLeadStatus(leadId, status);
    return { content: [{ type: "text", text: lead ? `${lead.id} → ${lead.status}` : `no lead ${leadId}` }] };
  },
);

await server.connect(new StdioServerTransport());
