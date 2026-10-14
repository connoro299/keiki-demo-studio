import { startHttp } from "./http";
import { startSlack } from "./slack";

/** `npm run bot`: starts every front door that has credentials. Run it on one always-on machine. */
const started: string[] = [];
if (!process.env.ANTHROPIC_API_KEY) console.warn("warning: ANTHROPIC_API_KEY is not set; demo jobs will fail until it is.");
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
  await startSlack();
  started.push("slack");
}
if (process.env.BOT_API_TOKEN) {
  startHttp(Number(process.env.PORT ?? process.env.BOT_PORT ?? 8787));
  started.push("http");
}
if (started.length === 0) {
  console.error("Nothing to start. Set SLACK_BOT_TOKEN + SLACK_APP_TOKEN (Slack) and/or BOT_API_TOKEN (webhook API). See docs/demo-bot.md.");
  process.exit(1);
}
