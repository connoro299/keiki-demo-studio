import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOutreachApi, parseRange, resolveMediaPath, type ApiOptions } from "@/outreach/api";
import { readLead, readXDraft, writeLead, writeXDraft } from "@/outreach/store";
import type { Lead, XDraft } from "@/outreach/types";

let tmp: string;
let root: string;
let repoRoot: string;
let server: Server | undefined;
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

const lead: Lead = {
  id: "harbor-abc123",
  url: "https://harborbarbers.co",
  status: "drafted",
  demos: [{ channel: "imessage", flowId: "f", flowPath: "p", story: "s", mp4: "outreach/leads/harbor-abc123/media/imessage.mp4" }],
  draft: { channel: "email", subject: "hi", body: "body" },
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

const draft: XDraft = {
  id: "x-42",
  tweet: { id: "42", url: "https://x.com/a/status/42", authorHandle: "a", text: "t" },
  reason: "r",
  score: 0.9,
  reply: "original",
  alternatives: ["alt"],
  status: "pending",
  source: "test",
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "outreach-api-"));
  repoRoot = path.join(tmp, "repo");
  root = path.join(repoRoot, "outreach");
  mkdirSync(path.join(root, "leads", lead.id, "media"), { recursive: true });
  writeFileSync(path.join(root, "leads", lead.id, "media", "imessage.mp4"), VIDEO);
  writeFileSync(path.join(root, "leads", lead.id, "media", "poster.png"), "png");
  writeFileSync(path.join(root, "leads", lead.id, "notes.txt"), "not media");
  writeFileSync(path.join(tmp, "secret.mp4"), "TOP-SECRET-BYTES");
  writeLead(lead, root);
  writeXDraft(draft, root);
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function start(options: Partial<ApiOptions> = {}): Promise<string> {
  const handle = createOutreachApi({ root: () => root, repoRoot, loadPipeline: async () => null, pipelineCliInstalled: () => false, ...options });
  server = createServer((req, res) => {
    handle(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 418;
        res.end("not mine");
      }
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/outreach`;
}

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = (body: unknown) => ({ ...json(body), method: "PATCH" });

describe("leads routes", () => {
  it("lists leads with pipeline availability and passes unrelated paths through", async () => {
    const base = await start();
    const body = await (await fetch(`${base}/leads`)).json();
    expect(body.leads.map((l: Lead) => l.id)).toEqual([lead.id]);
    expect(body.pipeline).toEqual({ installed: false, cli: false });
    expect((await fetch(base.replace("/api/outreach", "/other"))).status).toBe(418);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("GET/PATCH lead: edits the draft, status and notes, and validates input", async () => {
    const base = await start();
    expect((await fetch(`${base}/lead/${lead.id}`)).status).toBe(200);
    expect((await fetch(`${base}/lead/missing`)).status).toBe(404);
    expect((await fetch(`${base}/lead/..%2F..%2Fetc`)).status).toBe(400);

    const contact = { kind: "email", value: "marco@harborbarbers.co", label: "Owner", source: "site", confidence: 0.9 };
    const res = await fetch(`${base}/lead/${lead.id}`, patch({ status: "approved", notes: "warm", draft: { subject: "Saturday fades", to: contact } }));
    expect(res.status).toBe(200);
    expect(readLead(lead.id, root)).toMatchObject({ status: "approved", notes: "warm", draft: { subject: "Saturday fades", body: "body", to: contact } });

    await fetch(`${base}/lead/${lead.id}`, patch({ draft: { to: "typed@example.com" } }));
    expect(readLead(lead.id, root)?.draft?.to).toMatchObject({ kind: "email", value: "typed@example.com" });

    expect((await fetch(`${base}/lead/${lead.id}`, patch({ status: "analyzing" }))).status).toBe(400);
    expect((await fetch(`${base}/lead/${lead.id}`, patch({ draft: { body: 5 } }))).status).toBe(400);
    expect((await fetch(`${base}/lead/${lead.id}`, { method: "PATCH", body: "not json" })).status).toBe(400);
  });

  it("POST leads falls back to queued store records when the pipeline is missing", async () => {
    const base = await start();
    const res = await fetch(`${base}/leads`, json({ urls: ["sproutdental.com", "https://sproutdental.com/", "not a url at all", "lumencoffee.com"] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.via).toBe("store");
    expect(body.leads.map((l: Lead) => [l.url, l.status])).toEqual([["https://sproutdental.com", "queued"], ["https://lumencoffee.com", "queued"]]);
    expect(body.invalid).toEqual(["not a url at all"]);
    expect((await fetch(`${base}/leads`, json({ urls: [] }))).status).toBe(400);
  });

  it("POST leads uses the pipeline's addLeads when installed", async () => {
    const received: string[][] = [];
    const base = await start({
      loadPipeline: async () => ({
        addLeads: async (urls: string[]) => {
          received.push(urls);
          return urls.map((url) => ({ ...lead, id: "pipe-1", url, status: "queued" as const }));
        },
      }),
    });
    const body = await (await fetch(`${base}/leads`, json({ urls: ["sproutdental.com"] }))).json();
    expect(received).toEqual([["https://sproutdental.com"]]);
    expect(body.via).toBe("pipeline");
    expect(body.leads[0].id).toBe("pipe-1");
  });

  it("POST run is 501 without the pipeline CLI and spawns it detached when present", async () => {
    expect((await fetch(`${await start()}/run`, json({}))).status).toBe(501);
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    const spawned: Array<{ cwd: string; env: NodeJS.ProcessEnv; concurrency?: number }> = [];
    const base = await start({ pipelineCliInstalled: () => true, spawnRun: (args) => (spawned.push(args), { pid: 123 }) });
    const res = await fetch(`${base}/run`, json({ concurrency: 3 }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true, pid: 123, command: "npm run outreach -- run --concurrency 3" });
    expect(spawned[0].cwd).toBe(repoRoot);
    expect(spawned[0].env.OUTREACH_DIR).toBe(root);
    expect(spawned[0].concurrency).toBe(3);
  });
});

describe("x routes", () => {
  it("lists drafts and patches reply/status with validation", async () => {
    const base = await start();
    expect((await (await fetch(`${base}/x`)).json()).drafts.map((d: XDraft) => d.id)).toEqual(["x-42"]);
    const res = await fetch(`${base}/x/x-42`, patch({ reply: "edited", status: "posted" }));
    expect(res.status).toBe(200);
    expect(readXDraft("x-42", root)).toMatchObject({ reply: "edited", status: "posted", alternatives: ["alt"] });
    expect((await fetch(`${base}/x/x-42`, patch({ status: "sent" }))).status).toBe(400);
    expect((await fetch(`${base}/x/x-nope`, patch({ reply: "x" }))).status).toBe(404);
    expect((await fetch(`${base}/x`, { method: "DELETE" })).status).toBe(405);
  });
});

describe("file route", () => {
  it("streams repo-relative, root-relative and absolute paths inside the outreach dir", async () => {
    const base = await start();
    for (const p of [lead.demos[0].mp4!, `leads/${lead.id}/media/imessage.mp4`, path.join(root, "leads", lead.id, "media", "imessage.mp4")]) {
      const res = await fetch(`${base}/file?path=${encodeURIComponent(p)}`);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/mp4");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(Buffer.from(await res.arrayBuffer()).equals(VIDEO)).toBe(true);
    }
    const png = await fetch(`${base}/file?path=${encodeURIComponent(`leads/${lead.id}/media/poster.png`)}&download=1`);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("content-disposition")).toBe('attachment; filename="poster.png"');
  });

  it("serves byte ranges so <video> can scrub", async () => {
    const base = await start();
    const url = `${base}/file?path=${encodeURIComponent(`leads/${lead.id}/media/imessage.mp4`)}`;
    const mid = await fetch(url, { headers: { range: "bytes=100-199" } });
    expect(mid.status).toBe(206);
    expect(mid.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(mid.headers.get("content-length")).toBe("100");
    expect(Buffer.from(await mid.arrayBuffer()).equals(VIDEO.subarray(100, 200))).toBe(true);

    const open = await fetch(url, { headers: { range: "bytes=900-" } });
    expect(open.headers.get("content-range")).toBe("bytes 900-999/1000");
    const suffix = await fetch(url, { headers: { range: "bytes=-10" } });
    expect(Buffer.from(await suffix.arrayBuffer()).equals(VIDEO.subarray(990))).toBe(true);

    const bad = await fetch(url, { headers: { range: "bytes=5000-6000" } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */1000");
  });

  it("rejects path traversal, absolute paths outside, symlink escapes and non-media files", async () => {
    const base = await start();
    symlinkSync(path.join(tmp, "secret.mp4"), path.join(root, "leads", lead.id, "media", "link.mp4"));
    const status = async (p: string) => (await fetch(`${base}/file?path=${encodeURIComponent(p)}`)).status;
    expect(await status("../secret.mp4")).toBe(403);
    expect(await status("../../secret.mp4")).toBe(403);
    expect(await status(`leads/${lead.id}/../../../secret.mp4`)).toBe(403);
    expect(await status(path.join(tmp, "secret.mp4"))).toBe(403);
    expect(await status("/etc/passwd")).toBe(403);
    expect(await status(`leads/${lead.id}/media/link.mp4`)).toBe(403);
    expect(await status(`leads/${lead.id}/notes.txt`)).toBe(403);
    expect(await status(`leads/${lead.id}/media/missing.mp4`)).toBe(404);
    expect(await status("")).toBe(400);
    const body = await (await fetch(`${base}/file?path=..%2F..%2Fsecret.mp4`)).text();
    expect(body).not.toContain("TOP-SECRET-BYTES");
  });
});

describe("helpers", () => {
  it("parseRange", () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange("bytes=0-4", 10)).toEqual({ start: 0, end: 4 });
    expect(parseRange("bytes=5-", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 });
    expect(parseRange("bytes=10-", 10)).toBe("invalid");
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
  });

  it("resolveMediaPath stays inside the root", () => {
    expect(resolveMediaPath("../x.mp4", root, repoRoot)).toEqual({ status: 403, error: "path is outside the outreach dir" });
    expect(resolveMediaPath(`leads/${lead.id}/media/imessage.mp4`, root, repoRoot)).toHaveProperty("file");
  });
});
