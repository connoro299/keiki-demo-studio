import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCaptureEngine } from "@/cli/capture/engine";
import { isAllowedCaptureUrl } from "@/cli/capture/network";
import { runCli } from "@/cli/run";
import { fixturePath, makeDeps, parseStdoutJson, startHtmlServer } from "./helpers";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("preview and capture CLI", () => {
  it("prints the bound URL only after the mocked server is ready", async () => {
    const { deps, io } = makeDeps({
      startPreviewServer: async () => ({
        url: "http://127.0.0.1:4242/",
        host: "127.0.0.1",
        port: 4242,
        close: async () => undefined,
      }),
    });
    const previous = process.env.IMESSAGE_DEMO_PREVIEW_ONCE;
    process.env.IMESSAGE_DEMO_PREVIEW_ONCE = "1";
    try {
      const code = await runCli(["preview", fixturePath("valid-flow.json"), "--json", "--port", "4242"], deps);
      expect(code).toBe(0);
      expect(parseStdoutJson(io.stdout())).toEqual({
        ok: true,
        url: "http://127.0.0.1:4242/",
        host: "127.0.0.1",
        port: 4242,
      });
      expect(io.stderr()).toContain("preview ready on http://127.0.0.1:4242/");
    } finally {
      if (previous === undefined) delete process.env.IMESSAGE_DEMO_PREVIEW_ONCE;
      else process.env.IMESSAGE_DEMO_PREVIEW_ONCE = previous;
    }
  });

  it("fails on an occupied explicit port", async () => {
    const occupier = createServer();
    await new Promise<void>((resolve) => occupier.listen(0, "127.0.0.1", () => resolve()));
    const address = occupier.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const { deps, io } = makeDeps();
    try {
      const previous = process.env.IMESSAGE_DEMO_PREVIEW_ONCE;
      process.env.IMESSAGE_DEMO_PREVIEW_ONCE = "1";
      const code = await runCli(["preview", fixturePath("valid-flow.json"), "--json", "--port", String(address.port)], deps);
      if (previous === undefined) delete process.env.IMESSAGE_DEMO_PREVIEW_ONCE;
      else process.env.IMESSAGE_DEMO_PREVIEW_ONCE = previous;
      expect(code).toBe(3);
      expect(parseStdoutJson(io.stdout())).toMatchObject({ ok: false, exitCode: 3 });
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  });

  it("isolates concurrent capture output paths and cleans only owned resources", async () => {
    const closed: string[] = [];
    const { deps: first } = makeDeps({
      startPreviewServer: async ({ port }) => ({
        url: `http://127.0.0.1:${port ?? 4101}/`,
        host: "127.0.0.1",
        port: port ?? 4101,
        close: async () => {
          closed.push(`4101`);
        },
      }),
      runCaptureEngine: async (input) => fakeSuccess(input.outputDir),
    });
    const { deps: second } = makeDeps({
      startPreviewServer: async ({ port }) => ({
        url: `http://127.0.0.1:${port ?? 4102}/`,
        host: "127.0.0.1",
        port: port ?? 4102,
        close: async () => {
          closed.push(`4102`);
        },
      }),
      runCaptureEngine: async (input) => fakeSuccess(input.outputDir),
    });
    const outA = mkdtempSync(path.join(os.tmpdir(), "cap-a-"));
    const outB = mkdtempSync(path.join(os.tmpdir(), "cap-b-"));
    tempDirs.push(outA, outB);
    const [codeA, codeB] = await Promise.all([
      runCli(["capture", fixturePath("valid-flow.json"), "--json", "--port", "4101", "--out", outA], first),
      runCli(["capture", fixturePath("valid-flow.json"), "--json", "--port", "4102", "--out", outB], second),
    ]);
    expect(codeA).toBe(0);
    expect(codeB).toBe(0);
    expect(existsSync(path.join(outA, "manifest.json"))).toBe(true);
    expect(existsSync(path.join(outB, "manifest.json"))).toBe(true);
    expect(path.resolve(outA)).not.toBe(path.resolve(outB));
    expect(closed.sort()).toEqual(["4101", "4102"]);
  });

  it("writes failure.json and no success manifest when capture throws", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "cap-fail-"));
    tempDirs.push(out);
    const { deps } = makeDeps({
      startPreviewServer: async () => ({
        url: "http://127.0.0.1:4103/",
        host: "127.0.0.1",
        port: 4103,
        close: async () => undefined,
      }),
      runCaptureEngine: async () => {
        throw new Error("browser exploded");
      },
    });
    const code = await runCli(["capture", fixturePath("valid-flow.json"), "--json", "--out", out], deps);
    expect(code).toBe(3);
    expect(existsSync(path.join(out, "failure.json"))).toBe(true);
    expect(existsSync(path.join(out, "manifest.json"))).toBe(false);
  });
});

describe("capture engine", { timeout: 60_000 }, () => {
  it("allows only the local origin", () => {
    expect(isAllowedCaptureUrl("http://127.0.0.1:4120/src/player/host/main.tsx", "http://127.0.0.1:4120/")).toBe(true);
    expect(isAllowedCaptureUrl("https://example.com/article", "http://127.0.0.1:4120/")).toBe(false);
    expect(isAllowedCaptureUrl("data:image/png;base64,aa", "http://127.0.0.1:4120/")).toBe(true);
  });

  it("screenshots the frame, records receipts, and does not request a displayed link", async () => {
    const html = readFileSync(fixturePath("capture-host.html"), "utf8");
    const server = await startHtmlServer(html);
    const out = mkdtempSync(path.join(os.tmpdir(), "cap-engine-"));
    tempDirs.push(out);
    try {
      const result = await runCaptureEngine({
        repoRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
        origin: server.origin,
        scenarioId: "agent-text",
        platform: "ios",
        theme: "light",
        outputDir: out,
        checkpoints: [{ id: "after-reply", atMs: 1000 }],
        checkpoint: "after-reply",
        intervalMs: 1000,
        durationMs: 2000,
      });
      expect(existsSync(result.manifest)).toBe(true);
      expect(result.samples).toHaveLength(1);
      expect(result.samples[0]?.receipt.revision).toBeGreaterThan(0);
      expect(result.samples[0]?.receipt.timeMs).toBe(1000);
      expect(existsSync(result.samples[0]!.png)).toBe(true);
      const manifest = JSON.parse(readFileSync(result.manifest, "utf8")) as { environment: { locale: string; timeZone: string } };
      expect(manifest.environment.locale).toBe("en-US");
      expect(manifest.environment.timeZone).toBe("UTC");
    } finally {
      await server.close();
    }
  });

  it("samples frames at logical timestamps", async () => {
    const html = readFileSync(fixturePath("capture-host.html"), "utf8");
    const server = await startHtmlServer(html);
    const out = mkdtempSync(path.join(os.tmpdir(), "cap-frames-"));
    tempDirs.push(out);
    try {
      const result = await runCaptureEngine({
        repoRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
        origin: server.origin,
        scenarioId: "agent-text",
        platform: "ios",
        theme: "light",
        outputDir: out,
        checkpoints: [],
        frames: true,
        intervalMs: 1000,
        durationMs: 2000,
      });
      expect(result.samples.map((sample) => sample.atMs)).toEqual([0, 1000, 2000]);
    } finally {
      await server.close();
    }
  });

  it("fails when the page fetches external media", async () => {
    const html = `${readFileSync(fixturePath("capture-host.html"), "utf8")}<script>fetch("https://example.com/og.jpg")</script>`;
    const server = await startHtmlServer(html);
    const out = mkdtempSync(path.join(os.tmpdir(), "cap-block-"));
    tempDirs.push(out);
    try {
      await expect(
        runCaptureEngine({
          repoRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
          origin: server.origin,
          scenarioId: "agent-text",
          platform: "ios",
          theme: "light",
          outputDir: out,
          checkpoints: [],
          atMs: 0,
          intervalMs: 1000,
          durationMs: 0,
        }),
      ).rejects.toThrow(/External network/);
      expect(existsSync(path.join(out, "manifest.json"))).toBe(false);
    } finally {
      await server.close();
    }
  });
});

function fakeSuccess(outputDir: string) {
  const png = path.join(outputDir, "frame.png");
  const manifest = path.join(outputDir, "manifest.json");
  writeFileSync(png, "png");
  writeFileSync(manifest, `${JSON.stringify({ ok: true, png })}\n`);
  return {
    ok: true as const,
    samples: [
      {
        atMs: 0,
        png,
        receipt: {
          revision: 1,
          timeMs: 0,
          platform: "ios" as const,
          theme: "light" as const,
          digest: "x",
          renderer: { timeMs: 0, platform: "ios" as const, theme: "light" as const, width: 402, height: 874 },
        },
      },
    ],
    manifest,
    environment: {},
  };
}
