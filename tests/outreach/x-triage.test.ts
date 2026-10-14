import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompleteOptions } from "@/outreach/llm";
import { listXDrafts, readXDraft, writeLead, writeXDraft } from "@/outreach/store";
import type { DemoAsset, Lead, XDraft } from "@/outreach/types";
import { runXCli } from "@/outreach/x/cli";
import { LLM_UNAVAILABLE, checkLlm } from "@/outreach/x/llm-check";
import { candidatesFromJson, dedupeCandidates, draftCandidates } from "@/outreach/x/queue";
import type { XCandidate } from "@/outreach/x/search";
import { findAuthorSite } from "@/outreach/x/site";
import { MAX_REPLY_CHARS, cleanReply, triageCandidate } from "@/outreach/x/triage";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "x-queue-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function candidate(id: string, overrides: Partial<XCandidate["tweet"]> = {}, authorLinks: string[] = []): XCandidate {
  return {
    tweet: { id, url: `https://x.com/owner/status/${id}`, authorHandle: "owner", text: "drowning in customer texts all day", ...overrides },
    authorLinks,
    source: "test",
  };
}

type FakeReply = { score: number; reason?: string; site?: string | null; reply?: string; alternatives?: string[]; demoReply?: string | null };

/** Fake Claude: answers by tweet id and records every prompt. */
function fakeLlm(byId: Record<string, FakeReply | Error>) {
  const calls: CompleteOptions[] = [];
  const completeJson = async <T,>(options: CompleteOptions): Promise<T> => {
    calls.push(options);
    const id = (JSON.parse(options.prompt) as { tweet: { url: string } }).tweet.url.split("/").at(-1)!;
    const answer = byId[id] ?? { score: 0.9, reason: "fit", reply: "you could have an agent answer those", alternatives: ["alt one", "alt two"] };
    if (answer instanceof Error) throw answer;
    return answer as T;
  };
  return { completeJson, calls };
}

describe("cleanReply", () => {
  it("strips hashtags, emojis, links and DM-me sentences", () => {
    expect(cleanReply("an agent can answer those 🙌 #smallbiz https://keiki.ai. DM me if you want one!")).toBe("an agent can answer those.");
  });

  it("keeps the demo arrow only when allowed", () => {
    expect(cleanReply("made you a quick demo ↓", { allowArrow: true })).toBe("made you a quick demo ↓");
    expect(cleanReply("made you a quick demo ↓")).toBe("made you a quick demo");
  });

  it("cuts to the limit at a sentence boundary", () => {
    const long = `${"a".repeat(150)}. ${"b".repeat(150)}.`;
    expect(cleanReply(long)).toBe(`${"a".repeat(150)}.`);
    const oneSentence = "word ".repeat(80).trim();
    const cut = cleanReply(oneSentence);
    expect(Array.from(cut).length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("does not break decimals into sentences", () => {
    expect(cleanReply("it costs $2.50 a day. nice")).toBe("it costs $2.50 a day. nice");
  });
});

describe("findAuthorSite", () => {
  it("prefers profile links, skips socials and link-in-bio pages, reads bare bio domains", () => {
    expect(findAuthorSite(["https://linktr.ee/harbor", "https://www.harborbarbers.co/book"])).toBe("https://harborbarbers.co");
    expect(findAuthorSite(["https://instagram.com/x"], "Owner of Lumen. lumencoffee.com | Austin")).toBe("https://lumencoffee.com");
    expect(findAuthorSite([], "just vibes")).toBeUndefined();
  });
});

describe("triageCandidate", () => {
  it("scores, explains and drafts with the injected model", async () => {
    const llm = fakeLlm({ "1": { score: 0.93, reason: "  owner\nwith booking pain ", reply: "you could have an agent book those #ai 🚀", alternatives: ["ask them back?", "a tip"] } });
    const result = await triageCandidate(candidate("1", { authorBio: "harborbarbers.co" }), llm);
    expect(result).toMatchObject({ score: 0.93, reason: "owner with booking pain", reply: "you could have an agent book those", alternatives: ["ask them back?", "a tip"], site: "https://harborbarbers.co" });
    expect(llm.calls[0].system).toContain("No hashtags");
    expect(JSON.parse(llm.calls[0].prompt).author.knownSite).toBe("https://harborbarbers.co");
  });

  it("clamps scores and refuses sites the model invented", async () => {
    const llm = fakeLlm({ "2": { score: 7, site: "https://made-up-business.com", reply: "x" } });
    const result = await triageCandidate(candidate("2"), llm);
    expect(result.score).toBe(1);
    expect(result.site).toBeUndefined();
  });

  it("accepts a model-found site when the tweet names it, and returns demoReply only when asked", async () => {
    const llm = fakeLlm({ "3": { score: 0.8, site: "sproutdental.com", reply: "r", demoReply: "made you a quick demo of that ↓" } });
    const withDemo = await triageCandidate(candidate("3", { text: "our front desk at sproutdental.com is buried" }), llm, { wantDemo: true });
    expect(withDemo.site).toBe("https://sproutdental.com");
    expect(withDemo.demoReply).toBe("made you a quick demo of that ↓");
    const without = await triageCandidate(candidate("3", { text: "our front desk at sproutdental.com is buried" }), llm);
    expect(without.demoReply).toBeUndefined();
  });
});

describe("dedupe and drafting", () => {
  it("dedupes against existing drafts and within the batch", () => {
    const existing = [{ tweet: { id: "1" } } as XDraft];
    const { fresh, duplicates } = dedupeCandidates([candidate("1"), candidate("2"), candidate("2")], existing);
    expect(fresh.map((c) => c.tweet.id)).toEqual(["2"]);
    expect(duplicates).toEqual(["1", "2"]);
  });

  it("writes pending drafts, auto-skips low scores, and never re-triages a known tweet", async () => {
    const llm = fakeLlm({ low: { score: 0.3, reason: "AI hype thread", reply: "" } });
    const first = await draftCandidates([candidate("high"), candidate("low")], { completeJson: llm.completeJson, root }, { threshold: 0.6 });
    expect(first.drafted.map((d) => d.id)).toEqual(["x-high"]);
    expect(first.belowThreshold.map((d) => d.id)).toEqual(["x-low"]);
    expect(readXDraft("x-low", root)).toMatchObject({ status: "skipped", notes: expect.stringContaining("below threshold 0.6") });
    expect(readXDraft("x-high", root)).toMatchObject({ status: "pending", alternatives: ["alt one", "alt two"] });

    const second = await draftCandidates([candidate("high"), candidate("low"), candidate("new")], { completeJson: llm.completeJson, root });
    expect(second.duplicates.sort()).toEqual(["high", "low"]);
    expect(second.drafted.map((d) => d.id)).toEqual(["x-new"]);
    expect(llm.calls).toHaveLength(3);
  });

  it("stops the whole run with one message when Claude is unavailable", async () => {
    const llm = fakeLlm({ a: new Error("claude CLI error: Not logged in · Please run /login"), b: new Error("Not logged in") });
    await expect(draftCandidates([candidate("a"), candidate("b")], { completeJson: llm.completeJson, root })).rejects.toThrow(LLM_UNAVAILABLE);
    expect(listXDrafts(root)).toEqual([]);
  });

  it("records ordinary failures per tweet and keeps going", async () => {
    const llm = fakeLlm({ bad: new Error("model reply had no JSON") });
    const run = await draftCandidates([candidate("bad"), candidate("good")], { completeJson: llm.completeJson, root });
    expect(run.failed).toEqual([{ tweetId: "bad", error: "model reply had no JSON" }]);
    expect(run.drafted.map((d) => d.id)).toEqual(["x-good"]);
  });

  it("--demo attaches a pipeline demo and promotes the demo reply", async () => {
    const demo: DemoAsset = { channel: "imessage", flowId: "f", flowPath: "p", story: "s", mp4: "leads/harbor/media/imessage.mp4" };
    const llm = fakeLlm({ d: { score: 0.9, reply: "plain reply", alternatives: ["alt"], demoReply: "made you a quick demo ↓" } });
    const pipelineCalls: string[] = [];
    const run = await draftCandidates([candidate("d", {}, ["https://harborbarbers.co"])], {
      completeJson: llm.completeJson,
      root,
      loadPipeline: async () => ({
        addLeads: async (urls: string[]) => {
          pipelineCalls.push(...urls);
          const lead: Lead = { id: "harbor", url: urls[0], status: "queued", demos: [], createdAt: "", updatedAt: "" };
          writeLead(lead, root);
          return [lead];
        },
        processLead: async (lead: Lead | string) => ({ ...(lead as Lead), status: "drafted" as const, demos: [{ ...demo, mp4: undefined, channel: "sms" as const }, demo] }),
      }),
    }, { demo: true });
    expect(pipelineCalls).toEqual(["https://harborbarbers.co"]);
    expect(run.drafted[0]).toMatchObject({ demo, reply: "made you a quick demo ↓", alternatives: ["plain reply", "alt"] });
  });

  it("--demo without the pipeline keeps the draft and reports demo generation unavailable", async () => {
    const llm = fakeLlm({});
    const run = await draftCandidates([candidate("e", {}, ["https://lumencoffee.com"])], { completeJson: llm.completeJson, root, loadPipeline: async () => null }, { demo: true });
    expect(run.drafted).toHaveLength(1);
    expect(run.drafted[0].demo).toBeUndefined();
    expect(run.demoErrors[0].error).toMatch(/demo generation unavailable/);
  });
});

describe("import formats", () => {
  it("accepts arrays, { tweets }, and X API responses", async () => {
    const fromArray = await candidatesFromJson(
      [{ url: "https://x.com/kayla/status/77", text: "anyone know a tool for cake DMs", author: { name: "Kayla", description: "cakes. crumbco.com" } }, { text: "no id" }],
      "import",
      {},
    );
    expect(fromArray.candidates[0].tweet).toMatchObject({ id: "77", authorHandle: "kayla", authorName: "Kayla", authorBio: "cakes. crumbco.com" });
    expect(fromArray.failed).toHaveLength(1);
    const wrapped = await candidatesFromJson({ tweets: [{ id: "5", username: "@sam", text: "hi" }] }, "import", {});
    expect(wrapped.candidates[0].tweet).toMatchObject({ id: "5", authorHandle: "sam", url: "https://x.com/sam/status/5" });
    const api = await candidatesFromJson({ data: [{ id: "9", text: "t", author_id: "u" }], includes: { users: [{ id: "u", username: "z" }] } }, "import", {});
    expect(api.candidates[0].tweet.authorHandle).toBe("z");
  });

  it("looks up url-only entries via oEmbed", async () => {
    const result = await candidatesFromJson([{ url: "https://x.com/jack/status/20" }], "import", {
      fetchImpl: async () => new Response(JSON.stringify({ html: '<blockquote><p lang="en">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>' })),
    });
    expect(result.candidates[0].tweet.text).toBe("just setting up my twttr");
  });
});

describe("checkLlm", () => {
  it("accepts an API key without running anything", () => {
    expect(checkLlm({ ANTHROPIC_API_KEY: "k" }, () => { throw new Error("should not run"); })).toEqual({ ok: true, via: "api" });
  });
  it("reads `claude auth status`", () => {
    expect(checkLlm({}, () => ({ status: 0, stdout: '{"loggedIn": true}' }))).toEqual({ ok: true, via: "cli" });
    expect(checkLlm({}, () => ({ status: 1, stdout: '{"loggedIn": false}' }))).toEqual({ ok: false, message: LLM_UNAVAILABLE });
    expect(checkLlm({}, () => ({ status: null, stdout: "", error: new Error("ENOENT") }))).toEqual({ ok: false, message: LLM_UNAVAILABLE });
  });
});

describe("x CLI", () => {
  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) }, out, err };
  }
  const OEMBED = async () =>
    new Response(JSON.stringify({ html: '<blockquote><p lang="en">missed 7 calls under a sink today</p>&mdash; Jess (@jessplumbs) <a href="https://x.com/jessplumbs/status/42">October 14, 2026</a></blockquote>' }));

  it("add → list → show → skip, all with --json", async () => {
    const llm = fakeLlm({ "42": { score: 0.88, reason: "plumber missing calls", reply: "an agent can text back every missed call", alternatives: ["a", "b"] } });
    const a = io();
    expect(await runXCli(["add", "https://x.com/jessplumbs/status/42", "--json"], { root, io: a.io, completeJson: llm.completeJson, fetchImpl: OEMBED })).toBe(0);
    const added = JSON.parse(a.out.join("\n"));
    expect(added.drafted[0]).toMatchObject({ id: "x-42", score: 0.88, status: "pending", tweet: { authorHandle: "jessplumbs" } });

    const l = io();
    await runXCli(["list", "--json"], { root, io: l.io });
    expect(JSON.parse(l.out.join("\n")).map((d: XDraft) => d.id)).toEqual(["x-42"]);

    const s = io();
    await runXCli(["show", "https://x.com/jessplumbs/status/42", "--json"], { root, io: s.io });
    expect(JSON.parse(s.out.join("\n")).intent).toBe("https://x.com/intent/post?in_reply_to=42&text=an%20agent%20can%20text%20back%20every%20missed%20call");

    const k = io();
    await runXCli(["skip", "42", "--json"], { root, io: k.io });
    expect(readXDraft("x-42", root)?.status).toBe("skipped");

    const again = io();
    await runXCli(["add", "https://x.com/jessplumbs/status/42", "--json"], { root, io: again.io, completeJson: llm.completeJson, fetchImpl: OEMBED });
    expect(JSON.parse(again.out.join("\n")).duplicates).toEqual(["42"]);
    expect(llm.calls).toHaveLength(1);
  });

  it("fails fast with one clear message when Claude is unavailable", async () => {
    const c = io();
    const code = await runXCli(["add", "https://x.com/a/status/1"], { root, io: c.io, env: { CLAUDE_BIN: "/nonexistent/claude" } });
    expect(code).toBe(3);
    expect(c.err).toEqual([LLM_UNAVAILABLE]);
  });

  it("scan without X_BEARER_TOKEN points to add/import", async () => {
    const c = io();
    expect(await runXCli(["scan"], { root, io: c.io, env: {}, completeJson: fakeLlm({}).completeJson })).toBe(3);
    expect(c.err[0]).toMatch(/X_BEARER_TOKEN.*add <tweet-url…>/);
  });

  it("rejects non-tweet URLs and unknown presets as usage errors", async () => {
    expect(await runXCli(["add", "https://example.com"], { root, io: io().io, skipLlmCheck: true })).toBe(1);
    expect(await runXCli(["scan", "--preset", "nope"], { root, io: io().io, env: { X_BEARER_TOKEN: "t" }, skipLlmCheck: true })).toBe(1);
  });

  it("imports a JSON file", async () => {
    const file = path.join(root, "tweets.json");
    writeFileSync(file, JSON.stringify([{ id: "8", username: "kayla", text: "anyone know a tool to answer cake DMs" }]));
    const c = io();
    expect(await runXCli(["import", file, "--json"], { root, io: c.io, completeJson: fakeLlm({}).completeJson })).toBe(0);
    expect(readXDraft("x-8", root)?.source).toBe("import: tweets.json");
  });

  it("seed-fixtures refuses a non-empty dir without --force", async () => {
    writeXDraft({ id: "x-1", tweet: { id: "1", url: "", authorHandle: "a", text: "" }, reason: "", score: 1, reply: "", status: "pending", source: "", createdAt: "", updatedAt: "" }, root);
    const c = io();
    expect(await runXCli(["seed-fixtures", "--dir", root], { root, io: c.io })).toBe(2);
    expect(c.err[0]).toMatch(/not empty/);
  });
});
