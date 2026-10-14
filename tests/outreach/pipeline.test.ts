import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addLeads, nextStep, processLead, runQueue, type ExportVideoFn, type PipelineDeps } from "@/outreach/pipeline";
import { readLead, writeLead } from "@/outreach/store";
import { runOutreachCli } from "@/outreach/cli";
import type { LeadStatus } from "@/outreach/types";
import { fakeFetch, fakeLlm, fixture, tempRoot, validFlowReply } from "./helpers";

const emailReply = () => ({
  subject: "a demo for Lucia's",
  body: `Hi Marco,

Saw that your back room seats up to 24 and that Lucia still rolls the tagliatelle before every service. That is the kind of detail people remember when they book a birthday.

We made a quick demo of what an agent could do for Lucia's Trattoria on iMessage: a guest asks about the private room, gets 7pm held and pays the deposit by text. The GIF is attached.

If you want the live version on your own number, just reply "yes".

{{sender_name}}, Keiki

Not relevant? Reply 'no' and I won't follow up.`,
  xDm: "Hi Marco, we made a short demo of an agent booking your private room by text. Want it?",
});

const analysisReply = () => ({ name: "Lucia's Trattoria", summary: "Family-run trattoria in Park Slope.", vertical: "restaurant", tone: "warm", offerings: ["Handmade pasta"] });

function site() {
  return fakeFetch({
    "https://luciastrattoria.com": fixture("restaurant-home.html"),
    "https://luciastrattoria.com/contact": fixture("restaurant-contact.html"),
  });
}

function setup(replies: unknown[], extra: Partial<PipelineDeps> = {}) {
  const root = tempRoot();
  const repoRoot = path.dirname(root);
  const llm = fakeLlm(replies);
  const statuses: LeadStatus[] = [];
  const deps: PipelineDeps = {
    root,
    repoRoot,
    fetch: site().fetch,
    completeJson: llm.completeJson,
    renderHtml: async () => "<html></html>",
    log: (message) => {
      const id = message.split(":")[0];
      const lead = readLead(id, root);
      if (lead) statuses.push(lead.status);
    },
    ...extra,
  };
  return { root, repoRoot, llm, deps, statuses };
}

const fakeExport: ExportVideoFn = async (flowPath, options) => {
  mkdirSync(options.outDir, { recursive: true });
  const name = path.basename(flowPath, ".json");
  for (const ext of ["mp4", "gif", "png"]) writeFileSync(path.join(options.outDir, `${name}.${ext}`), "x");
  return { mp4: path.join(options.outDir, `${name}.mp4`), gif: path.join(options.outDir, `${name}.gif`), poster: path.join(options.outDir, `${name}.png`), durationMs: 17000, frames: 510 };
};

describe("addLeads", () => {
  it("is idempotent and keeps imported columns", () => {
    const root = tempRoot();
    const first = addLeads(["luciastrattoria.com", "https://luciastrattoria.com/", "not a url"], { root });
    expect(first.added).toHaveLength(1);
    expect(first.invalid).toEqual([{ input: "not a url", reason: "not a website URL or domain" }]);
    const again = addLeads([{ url: "luciastrattoria.com", input: { Email: "marco@luciastrattoria.com" } }], { root });
    expect(again.added).toHaveLength(0);
    expect(again.existing[0].id).toBe(first.added[0].id);
    expect(readLead(first.added[0].id, root)?.input).toEqual({ Email: "marco@luciastrattoria.com" });
  });
});

describe("processLead", () => {
  it("walks queued → analyzing → generating → rendering → drafted", async () => {
    const { root, deps, statuses, llm } = setup([analysisReply(), validFlowReply(), emailReply()], { exportVideo: fakeExport });
    const [lead] = addLeads(["luciastrattoria.com"], { root }).added;
    expect(lead.status).toBe("queued");
    const result = await processLead(lead.id, { channels: ["imessage"] }, deps);
    expect(result.ran).toEqual(["analyze", "generate", "render", "draft"]);
    expect(statuses).toEqual(["analyzing", "generating", "rendering", "rendering"]);
    expect(result.lead.status).toBe("drafted");
    expect(llm.calls).toHaveLength(3);
    const demo = result.lead.demos[0];
    expect(demo.flowPath).toBe(path.join(path.basename(root), "leads", lead.id, "flows", "lucia-s-trattoria-imessage.json"));
    expect(demo.mp4).toBe(path.join(path.basename(root), "leads", lead.id, "media", "lucia-s-trattoria-imessage", "lucia-s-trattoria-imessage.mp4"));
    expect(demo.durationMs).toBe(17000);
    expect(result.lead.draft).toMatchObject({ channel: "email", to: { value: "marco@luciastrattoria.com" } });
    expect(result.lead.draft?.attachments?.[0]).toMatch(/\.gif$/);
    expect(nextStep(result.lead)).toBeUndefined();
  });

  it("records the failed step and resumes from it", async () => {
    const { root, deps, llm } = setup([analysisReply(), new Error("Anthropic API 529: overloaded")], { exportVideo: fakeExport });
    const [lead] = addLeads(["luciastrattoria.com"], { root }).added;
    const failed = await processLead(lead.id, { channels: ["imessage"] }, deps);
    expect(failed.lead).toMatchObject({ status: "failed", failedStep: "generate", error: "Anthropic API 529: overloaded" });
    expect(failed.lead.profile?.name).toBe("Lucia's Trattoria");

    // Resume: analysis is not repeated.
    const resumeLlm = fakeLlm([validFlowReply(), emailReply()]);
    const resumed = await processLead(lead.id, { channels: ["imessage"] }, { ...deps, completeJson: resumeLlm.completeJson });
    expect(resumed.ran).toEqual(["generate", "render", "draft"]);
    expect(resumed.lead.status).toBe("drafted");
    expect(resumed.lead.error).toBeUndefined();
    expect(resumed.lead.failedStep).toBeUndefined();
    expect(llm.calls).toHaveLength(2);
  });

  it("drafts anyway when the export module is unavailable, and records why", async () => {
    const { root, deps } = setup([analysisReply(), validFlowReply(), emailReply()], { exportVideo: null });
    const [lead] = addLeads(["luciastrattoria.com"], { root }).added;
    const result = await processLead(lead.id, { channels: ["imessage"] }, deps);
    expect(result.lead.status).toBe("drafted");
    expect(result.lead.demos[0].renderError).toMatch(/export unavailable/);
    expect(result.lead.demos[0].mp4).toBeUndefined();
    // redo --from render once the exporter lands.
    const rerender = await processLead(lead.id, { from: "render" }, { ...deps, exportVideo: fakeExport, completeJson: fakeLlm([emailReply()]).completeJson });
    expect(rerender.ran).toEqual(["render", "draft"]);
    expect(rerender.lead.demos[0].renderError).toBeUndefined();
    expect(rerender.lead.demos[0].gif).toMatch(/\.gif$/);
  });

  it("fails the render step when the exporter throws, keeping demos for a retry", async () => {
    const { root, deps } = setup([analysisReply(), validFlowReply()], { exportVideo: async () => { throw new Error("ffmpeg missing"); } });
    const [lead] = addLeads(["luciastrattoria.com"], { root }).added;
    const result = await processLead(lead.id, { channels: ["imessage"] }, deps);
    expect(result.lead).toMatchObject({ status: "failed", failedStep: "render" });
    expect(result.lead.error).toMatch(/ffmpeg missing/);
    expect(result.lead.demos).toHaveLength(1);
  });

  it("with llm:false analyzes heuristically and waits before generation", async () => {
    const { root, deps, llm } = setup([]);
    const [lead] = addLeads(["luciastrattoria.com"], { root }).added;
    const result = await processLead(lead.id, { llm: false }, deps);
    expect(result).toMatchObject({ ran: ["analyze"], stoppedAt: "generate" });
    expect(result.lead.status).toBe("queued");
    expect(result.lead.profile?.analyzedWith).toBe("heuristic");
    expect(llm.calls).toHaveLength(0);
  });

  it("leaves approved/sent leads alone unless forced", async () => {
    const { root, deps } = setup([]);
    const [lead] = addLeads(["luciastrattoria.com"], { root }).added;
    writeLead({ ...lead, status: "sent" }, root);
    expect((await processLead(lead.id, {}, deps)).ran).toEqual([]);
  });
});

describe("runQueue", () => {
  it("processes queued and failed leads with bounded concurrency", async () => {
    const root = tempRoot();
    const sites: Record<string, string> = {};
    for (const name of ["alpha", "bravo", "charlie", "delta"]) sites[`https://${name}-cafe.com`] = `<html><head><title>${name} cafe</title></head><body><h1>Coffee and pastries</h1><a href="mailto:hello@${name}-cafe.com">email</a></body></html>`;
    let active = 0;
    let peak = 0;
    const fetchImpl = fakeFetch(sites).fetch;
    const slowFetch = (async (...args: Parameters<typeof fetch>) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await fetchImpl(...args);
      } finally {
        active -= 1;
      }
    }) as typeof fetch;
    addLeads(Object.keys(sites), { root });
    const result = await runQueue({ concurrency: 2, llm: false }, { root, repoRoot: path.dirname(root), fetch: slowFetch });
    expect(result.processed).toHaveLength(4);
    expect(result.waiting).toBe(4);
    expect(peak).toBeLessThanOrEqual(2 * 2); // two leads at a time, each with robots + page in flight
    const limited = await runQueue({ limit: 1, llm: false }, { root, repoRoot: path.dirname(root), fetch: fetchImpl });
    expect(limited.processed).toHaveLength(1);
  });
});

describe("cli", () => {
  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: { write: (chunk: string) => { out.push(chunk); } }, stderr: { write: (chunk: string) => { err.push(chunk); } } } };
  }

  it("adds, lists, shows and imports with --json", async () => {
    const root = tempRoot();
    const a = io();
    expect(await runOutreachCli(["add", "luciastrattoria.com", "glow.co", "--json"], { root, io: a.io })).toBe(0);
    expect(JSON.parse(a.out.join("")).added).toHaveLength(2);

    const csvFile = path.join(root, "leads.csv");
    writeFileSync(csvFile, "﻿Company,Website\nGlow,glow.co\nHarbor,\"harbor-dental.com\"\n");
    const b = io();
    expect(await runOutreachCli(["import", csvFile, "--json"], { root, io: b.io })).toBe(0);
    expect(JSON.parse(b.out.join(""))).toMatchObject({ added: 1, existing: 1, urlColumn: "Website" });

    const c = io();
    await runOutreachCli(["list"], { root, io: c.io });
    expect(c.out.join("")).toMatch(/ID\s+DOMAIN\s+STATUS\s+BEST CONTACT\s+DEMOS/);
    expect(c.out.join("")).toMatch(/harbor-dental\.com\s+queued/);

    const id = JSON.parse(a.out.join("")).added[0];
    const d = io();
    await runOutreachCli(["show", id, "--json"], { root, io: d.io });
    expect(JSON.parse(d.out.join("")).id).toBe(id);
  });

  it("fails fast with one clear message when Claude is unavailable", async () => {
    const root = tempRoot();
    addLeads(["luciastrattoria.com"], { root });
    const a = io();
    const code = await runOutreachCli(["run"], { root, io: a.io, llmStatus: async () => ({ ok: false, reason: "claude is not signed in" }) });
    expect(code).toBe(3);
    expect(a.err.join("")).toMatch(/No Claude access: set ANTHROPIC_API_KEY/);
    expect(readLead(addLeads(["luciastrattoria.com"], { root }).existing[0].id, root)?.status).toBe("queued");
  });

  it("gives helpful usage errors", async () => {
    const a = io();
    expect(await runOutreachCli(["redo"], { root: tempRoot(), io: a.io })).toBe(1);
    expect(a.err.join("")).toMatch(/redo needs a lead id/);
    const b = io();
    expect(await runOutreachCli(["run", "--channels", "fax", "--json"], { root: tempRoot(), io: b.io, llmStatus: async () => ({ ok: true, via: "api" }) })).toBe(1);
    expect(JSON.parse(b.out.join("")).error).toMatch(/unknown channel "fax"/);
    const c = io();
    expect(await runOutreachCli(["add", "x.com", "--bogus"], { root: tempRoot(), io: c.io })).toBe(1);
    expect(c.err.join("")).toMatch(/unknown option --bogus/);
  });
});
