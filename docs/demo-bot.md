# Demo bot

One always-on process that makes demos for the team. Tag it in Slack with a website (or a list), and it replies in a thread with the recorded video, a share link, and an email draft with Approve / Another story / Skip buttons. Other agents (a Keiki agent on WhatsApp or iMessage, a Zap, a Claude or Codex session) can call the same job over HTTP or MCP.

Nothing is ever emailed automatically. Approving marks the lead approved (visible in `npm run outreach -- list` and the dashboard); a person sends it.

## What it does per site

1. Reads the site (homepage plus contact, about, menu or booking pages) and finds the best contact.
2. Writes a customer ↔ agent conversation grounded in what the site says.
3. Records it as an MP4 (and GIF + poster) with the same renderer the studio uses.
4. Makes a short link on the studio (`/?s=…`) that plays the demo in a browser.
5. Drafts the email with the link in it, and saves everything as an outreach lead.

About 1–3 minutes per site. Batches run two at a time (`BOT_CONCURRENCY`).

## Set up (about 10 minutes)

1. **Slack app.** api.slack.com/apps → Create New App → From a manifest → paste `deploy/slack-app-manifest.yml` → Install to workspace.
   - Bot token: OAuth & Permissions → `xoxb-…` → `SLACK_BOT_TOKEN`
   - App token: Basic Information → App-Level Tokens → generate one with `connections:write` → `xapp-…` → `SLACK_APP_TOKEN`
2. **Environment** (in `.env.local` on the bot machine, or the host's env settings):

   | Variable | Needed for |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | Everything (reading sites, writing demos, drafting emails) |
   | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` | Slack |
   | `BLOB_READ_WRITE_TOKEN` | Short demo links and public MP4 URLs (same store as the studio: `vercel env pull`) |
   | `BOT_API_TOKEN` | The webhook API (any long random string) |
   | `STUDIO_URL` | Optional; defaults to https://keiki-demo-studio.vercel.app |
   | `STUDIO_MODEL` | Optional; defaults to `claude-sonnet-5-5` |

3. **Run it** somewhere that stays on:
   - **A Mac that's always on:** `npm ci && npm run bot`, or install `deploy/com.keiki.demo-bot.plist` so it restarts on its own.
   - **A container host (Railway, Fly, Render, any VPS):** build `deploy/Dockerfile` from the repo root (`docker build -f deploy/Dockerfile .`), set the env vars, mount a volume at `/data` so leads persist.

   Socket Mode means Slack connects outward from the bot, so it needs no public URL. Only the webhook API needs a reachable port.

## Using it in Slack

- `@Demo sproutdental.com`: one demo
- `@Demo sproutdental.com on whatsapp`: pick the channel (imessage, sms, whatsapp, telegram, slack)
- `@Demo` plus a pasted list, or a CSV attached: a batch, one reply per site, with a running count
- DM the bot the same way

## Webhook API

`Authorization: Bearer $BOT_API_TOKEN` on every call.

```
POST /v1/demos               { "url": "sproutdental.com", "channel": "whatsapp" }
  → { leadId, name, summary, channel, story, link, mp4Url, draft }
POST /v1/leads/:id/status    { "status": "approved" | "skipped" | "sent" }
GET  /health
```

A Keiki agent on WhatsApp or iMessage can call `POST /v1/demos` as a tool and send back `mp4Url` and `link`.

## MCP

For a Claude Code or Codex session on the same machine:

```
claude mcp add keiki-demos -- npm --prefix /path/to/imessagedemo run -s bot:mcp
```

Tools: `make_demo`, `list_demos`, `set_demo_status`.

## What's next

- Push approved drafts into Amplemarket sequences (sending, warm-up and unsubscribes handled there) instead of copying them out.
- Record replies per lead (story, channel, vertical, subject) and feed the winners back into the generation prompts.
