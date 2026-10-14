import { readFileSync } from "node:fs";
import { App } from "@slack/bolt";
import type { KnownBlock, WebClient } from "@slack/web-api";
import { CHANNEL_LABELS } from "@/studio/client";
import { channelFrom, extractSites, mapLimit, runDemoJob, setLeadStatus, type DemoJobProgress, type DemoJobResult } from "./core";

/**
 * Slack front door (Socket Mode: no public URL needed). Mention the bot or DM it:
 *   "@Demo sproutdental.com"                 → one demo: video + link + email draft in a thread
 *   "@Demo sproutdental.com on whatsapp"     → pick the channel
 *   "@Demo" + a pasted list or a CSV file     → a batch, one threaded reply per site
 * Drafts get Approve / Skip / Another story buttons. Nothing is ever emailed from here.
 */
const STEP_TEXT: Record<DemoJobProgress, string> = {
  reading: "Reading the site…",
  writing: "Writing the conversation…",
  rendering: "Recording the video…",
  drafting: "Drafting the email…",
};
const BATCH_CONCURRENCY = Number(process.env.BOT_CONCURRENCY ?? 2);
const MAX_BATCH = Number(process.env.BOT_MAX_BATCH ?? 100);

const HELP = [
  "Send me a website and I'll make a demo of that business's agent: a video, a link, and an email draft.",
  "• `sproutdental.com` makes one demo",
  "• `sproutdental.com on whatsapp` picks the channel (imessage, sms, whatsapp, telegram, slack)",
  "• Paste a list of sites, or attach a CSV, to make a batch",
  "Drafts are never sent automatically. Approve them here, then send.",
].join("\n");

export function startSlack(): Promise<void> {
  const app = new App({ token: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN, socketMode: true });

  const handle = async (args: { text: string; channel: string; ts: string; threadTs?: string; files?: Array<{ url_private_download?: string; name?: string; filetype?: string }>; client: WebClient }) => {
    const { client, channel } = args;
    const thread = args.threadTs ?? args.ts;
    let text = args.text.replace(/<@[A-Z0-9]+>/g, " ");
    for (const file of args.files ?? []) {
      if (file.url_private_download && /csv|text|plain/i.test(`${file.filetype} ${file.name}`)) {
        const response = await fetch(file.url_private_download, { headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
        if (response.ok) text += `\n${await response.text()}`;
      }
    }
    const sites = extractSites(text);
    if (sites.length === 0) {
      await client.chat.postMessage({ channel, thread_ts: thread, text: HELP });
      return;
    }
    const requestedChannel = channelFrom(text);
    if (sites.length === 1) {
      await runOne(client, channel, thread, sites[0], requestedChannel);
      return;
    }
    const list = sites.slice(0, MAX_BATCH);
    const head = await client.chat.postMessage({ channel, thread_ts: thread, text: `Making ${list.length} demos${sites.length > MAX_BATCH ? ` (first ${MAX_BATCH} of ${sites.length})` : ""}. Each one lands in this thread as it finishes.` });
    let done = 0;
    let failed = 0;
    await mapLimit(list, BATCH_CONCURRENCY, async (site) => {
      const ok = await runOne(client, channel, thread, site, requestedChannel);
      if (ok) done += 1; else failed += 1;
      await client.chat.update({ channel, ts: head.ts!, text: `Making ${list.length} demos · ${done} ready${failed ? ` · ${failed} didn't work` : ""}${done + failed === list.length ? " · finished" : ""}` }).catch(() => undefined);
    });
  };

  app.event("app_mention", async ({ event, client }) => {
    await handle({ text: event.text ?? "", channel: event.channel, ts: event.ts, threadTs: event.thread_ts, files: (event as { files?: [] }).files, client });
  });

  app.message(async ({ message, client }) => {
    const msg = message as { channel_type?: string; subtype?: string; bot_id?: string; text?: string; channel: string; ts: string; thread_ts?: string; files?: [] };
    if (msg.channel_type !== "im" || msg.bot_id || (msg.subtype && msg.subtype !== "file_share")) return;
    await handle({ text: msg.text ?? "", channel: msg.channel, ts: msg.ts, threadTs: msg.thread_ts, files: msg.files, client });
  });

  app.action("demo_approve", async ({ ack, body, client, action }) => {
    await ack();
    const leadId = (action as { value?: string }).value ?? "";
    setLeadStatus(leadId, "approved");
    await markDecision(client, body, `Approved by <@${body.user.id}>. Send it from your inbox.`);
  });

  app.action("demo_skip", async ({ ack, body, client, action }) => {
    await ack();
    setLeadStatus((action as { value?: string }).value ?? "", "skipped");
    await markDecision(client, body, `Skipped by <@${body.user.id}>.`);
  });

  app.action("demo_again", async ({ ack, body, client, action }) => {
    await ack();
    const { url, channel, story } = JSON.parse((action as { value?: string }).value ?? "{}") as { url: string; channel?: string; story?: string };
    const container = (body as { container?: { channel_id?: string; thread_ts?: string; message_ts?: string } }).container;
    if (!container?.channel_id) return;
    await runOne(client, container.channel_id, container.thread_ts ?? container.message_ts!, url, channel as never, story ? [story] : []);
  });

  return app.start().then(() => console.log("slack: connected (socket mode)"));
}

async function markDecision(client: WebClient, body: unknown, note: string): Promise<void> {
  const b = body as { channel?: { id: string }; message?: { ts: string; blocks?: KnownBlock[] } };
  if (!b.channel || !b.message) return;
  const blocks = (b.message.blocks ?? []).filter((block) => block.type !== "actions");
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
  await client.chat.update({ channel: b.channel.id, ts: b.message.ts, blocks, text: note });
}

async function runOne(client: WebClient, channel: string, thread: string, url: string, requested?: Parameters<typeof runDemoJob>[0]["channel"], previousStories: string[] = []): Promise<boolean> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const status = await client.chat.postMessage({ channel, thread_ts: thread, text: `*${host}* · ${STEP_TEXT.reading}` });
  const update = (text: string) => client.chat.update({ channel, ts: status.ts!, text }).catch(() => undefined);
  try {
    const result = await runDemoJob({ url, channel: requested, previousStories }, (step) => void update(`*${host}* · ${STEP_TEXT[step]}`));
    await postResult(client, channel, thread, result);
    await client.chat.delete({ channel, ts: status.ts! }).catch(() => update(`*${result.profile.name}* · done`));
    return true;
  } catch (error) {
    await update(`*${host}* · didn't work: ${friendly((error as Error).message)}`);
    return false;
  }
}

async function postResult(client: WebClient, channel: string, thread: string, result: DemoJobResult): Promise<void> {
  const label = CHANNEL_LABELS[result.channel];
  const summary = `*${result.profile.name}* · ${label}\n${result.story}${result.link ? `\n<${result.link}|Open the demo>` : ""}`;
  if (result.mp4) {
    await client.files.uploadV2({
      channel_id: channel,
      thread_ts: thread,
      file: readFileSync(result.mp4),
      filename: `${result.profile.name.replace(/[^\w-]+/g, "-")}-${result.channel}.mp4`,
      initial_comment: summary,
    });
  } else {
    await client.chat.postMessage({ channel, thread_ts: thread, text: `${summary}${result.renderError ? `\n_Video didn't render: ${friendly(result.renderError)}_` : ""}` });
  }

  const draft = result.draft;
  const to = draft.to ? (draft.to.kind === "email" ? draft.to.value : `${draft.to.kind}: ${draft.to.value}`) : "no public contact found";
  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `*Email draft* → ${to}\n*${draft.subject}*` } },
    { type: "section", text: { type: "mrkdwn", text: draft.body.replace(/\{\{sender_name\}\}/g, "[your name]").slice(0, 2900).split("\n").map((line) => `>${line}`).join("\n") } },
    {
      type: "actions",
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, action_id: "demo_approve", value: result.leadId },
        { type: "button", text: { type: "plain_text", text: "Another story" }, action_id: "demo_again", value: JSON.stringify({ url: result.url, channel: result.channel, story: result.story }).slice(0, 1900) },
        { type: "button", text: { type: "plain_text", text: "Skip" }, action_id: "demo_skip", value: result.leadId },
      ],
    },
  ];
  await client.chat.postMessage({ channel, thread_ts: thread, blocks, text: `Email draft for ${result.profile.name}` });
}

export function friendly(message: string): string {
  if (/\b403\b|cloudflare|challenge/i.test(message)) return "the site blocks automated readers";
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return "couldn't find that website";
  if (/abort|timeout/i.test(message)) return "the site took too long to respond";
  if (/ANTHROPIC|Claude|claude CLI/i.test(message)) return "Claude isn't configured on the bot machine (set ANTHROPIC_API_KEY)";
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

