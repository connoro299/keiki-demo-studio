import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CompleteOptions } from "@/outreach/llm";
import { readXDraft } from "@/outreach/store";
import { runXCli } from "@/outreach/x/cli";

/**
 * Live check of `npm run x -- add` against X's real public oEmbed endpoint, with a fake Claude.
 * Network-dependent, so it only runs with LIVE_OEMBED=1:  LIVE_OEMBED=1 npx vitest run tests/outreach/x-live.test.ts
 */
describe.runIf(process.env.LIVE_OEMBED === "1")("live oEmbed add", () => {
  it("adds https://x.com/jack/status/20 with no credentials", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "x-live-"));
    const prompts: string[] = [];
    const completeJson = async <T,>(options: CompleteOptions): Promise<T> => {
      prompts.push(options.prompt);
      return { score: 0.2, reason: "historic first tweet, not a business owner", reply: "" } as T;
    };
    try {
      const out: string[] = [];
      const code = await runXCli(["add", "https://x.com/jack/status/20", "--json"], { root, completeJson, io: { out: (l) => out.push(l), err: (l) => out.push(l) } });
      expect(code).toBe(0);
      const draft = readXDraft("x-20", root);
      expect(draft?.tweet).toMatchObject({ id: "20", authorHandle: "jack", text: "just setting up my twttr", createdAt: "2006-03-21T00:00:00.000Z" });
      expect(draft?.status).toBe("skipped");
      expect(JSON.parse(prompts[0]).tweet.text).toBe("just setting up my twttr");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
