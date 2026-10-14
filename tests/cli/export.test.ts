import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "@/cli/args";
import { CliError } from "@/cli/errors";
import { runCli } from "@/cli/run";
import type { CompiledDemo } from "@/contracts";
import { audioFilterGraph, planAudio } from "@/export/audio";
import { parseProbeOutput, resolveFfmpeg } from "@/export/ffmpeg";
import type { DetailedExportResult, ExportOptions } from "@/export/index";
import { frameSchedule, gifSteps, mp4Args, normalizeExportOptions, resolveFlowPath } from "@/export/video";
import { fixturePath, makeDeps, parseStdoutJson } from "./helpers";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function fakeBinary(dir: string, name = "ffmpeg"): string {
  const file = path.join(dir, name);
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return file;
}

function exitCodeOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof CliError ? error.exitCode : -1;
  }
  return undefined;
}

describe("export arguments", () => {
  it("parses every export flag", () => {
    const args = parseArgs([
      "export", "flow.json", "--out", "out/x", "--formats", "mp4,GIF", "--fps", "24", "--platform", "ios", "--theme", "dark",
      "--tail-ms", "800", "--scale", "1.5", "--gif-width", "360", "--gif-fps", "10", "--crf", "20", "--concurrency", "2",
      "--max-duration-ms", "90000", "--gpu", "--no-dedupe", "--json",
    ]);
    expect(args).toMatchObject({
      command: "export",
      file: "flow.json",
      out: "out/x",
      formats: ["mp4", "gif"],
      fps: 24,
      platform: "ios",
      theme: "dark",
      tailMs: 800,
      scale: 1.5,
      gifWidth: 360,
      gifFps: 10,
      crf: 20,
      concurrency: 2,
      maxDurationMs: 90000,
      gpu: true,
      dedupe: false,
      json: true,
    });
  });

  it("defaults leave export options to the library", () => {
    const args = parseArgs(["export", "flow.json"]);
    expect(args.formats).toBeUndefined();
    expect(args.fps).toBeUndefined();
    expect(args.theme).toBeUndefined();
    expect(args.gpu).toBe(false);
    expect(args.dedupe).toBe(true);
  });

  it("rejects bad export values with exit 1", () => {
    expect(exitCodeOf(() => parseArgs(["export", "f.json", "--formats", "mp4,webm"]))).toBe(1);
    expect(exitCodeOf(() => parseArgs(["export", "f.json", "--formats", ","]))).toBe(1);
    expect(exitCodeOf(() => parseArgs(["export", "f.json", "--theme", "sepia"]))).toBe(1);
    expect(exitCodeOf(() => parseArgs(["export", "f.json", "--fps", "0"]))).toBe(1);
    expect(exitCodeOf(() => parseArgs(["export", "f.json", "--fps", "29.97"]))).toBe(1);
    expect(exitCodeOf(() => parseArgs(["export", "f.json", "--scale", "9"]))).toBe(1);
    expect(exitCodeOf(() => parseArgs(["export", "f.json", "--fps"]))).toBe(1);
  });

  it("normalizes library options with the documented defaults", () => {
    const options = normalizeExportOptions({ outDir: "out" });
    expect(options).toMatchObject({ formats: ["mp4", "gif", "poster"], fps: 30, scale: 2, tailMs: 1200, gifWidth: 480, gifFps: 15, crf: 18, dedupe: true, gpu: false, requireEmptyOutDir: false });
    expect(options.maxGifBytes).toBe(5 * 1024 * 1024);
    expect(path.isAbsolute(options.outDir)).toBe(true);
    expect(exitCodeOf(() => normalizeExportOptions({ outDir: "out", formats: [] }))).toBe(1);
    expect(exitCodeOf(() => normalizeExportOptions({ outDir: "out", fps: 500 }))).toBe(1);
    expect(exitCodeOf(() => normalizeExportOptions({ outDir: "out", crf: 60 }))).toBe(1);
  });

  it("resolves absolute, cwd-relative, and repo-relative flow paths", () => {
    const absolute = path.join(repoRoot, "examples/typing-reactions.flow.json");
    expect(resolveFlowPath(absolute, repoRoot)).toBe(absolute);
    const elsewhere = tempDir("export-root-");
    expect(resolveFlowPath("examples/typing-reactions.flow.json", repoRoot)).toBe(absolute);
    // Repo-relative still resolves when it does not exist relative to the cwd.
    const fakeRepo = path.join(elsewhere, "repo");
    mkdirSync(path.join(fakeRepo, "flows"), { recursive: true });
    writeFileSync(path.join(fakeRepo, "flows/a.json"), "{}");
    expect(resolveFlowPath("flows/a.json", fakeRepo)).toBe(path.join(fakeRepo, "flows/a.json"));
  });
});

describe("export command", () => {
  function fakeResult(outDir: string): DetailedExportResult {
    const mp4 = path.join(outDir, "x.mp4");
    return {
      mp4,
      durationMs: 9100,
      frames: 273,
      capturedFrames: 200,
      timelineMs: 7900,
      tailMs: 1200,
      fps: 30,
      scale: 2,
      scenarioId: "x",
      platform: "ios",
      theme: "light",
      audio: false,
      files: { mp4: { path: mp4, bytes: 1234, width: 804, height: 1748, fps: 30, frames: 273, durationMs: 9100 } },
      manifest: path.join(outDir, "manifest.json"),
      ffmpeg: { path: "/bin/ffmpeg", source: "PATH" },
      timings: { framesMs: 1, gifMs: 0, posterMs: 0, totalMs: 2, renderSecondsPerVideoSecond: 0.1 },
      warnings: [],
    };
  }

  it("passes flags through and prints one JSON object with file sizes", async () => {
    const out = path.join(tempDir("export-cli-"), "run");
    let seen: { flow: unknown; options?: ExportOptions } = { flow: undefined };
    const { deps, io } = makeDeps({
      exportVideo: async (flow, options) => {
        seen = { flow, options };
        return fakeResult(options.outDir);
      },
    });
    const code = await runCli(["export", fixturePath("valid-flow.json"), "--out", out, "--formats", "mp4", "--fps", "24", "--theme", "dark", "--json"], deps);
    expect(code).toBe(0);
    expect(seen.flow).toBe(fixturePath("valid-flow.json"));
    expect(seen.options).toMatchObject({ outDir: path.resolve(out), formats: ["mp4"], fps: 24, theme: "dark", requireEmptyOutDir: true });
    const payload = parseStdoutJson(io.stdout()) as DetailedExportResult & { ok: boolean };
    expect(payload.ok).toBe(true);
    expect(payload.files.mp4?.bytes).toBe(1234);
    expect(payload.durationMs).toBe(9100);
    expect(io.stdout().trim().split("\n")).toHaveLength(1);
  });

  it("requires a flow file (exit 1)", async () => {
    const { deps, io } = makeDeps();
    expect(await runCli(["export", "--json"], deps)).toBe(1);
    expect(parseStdoutJson(io.stdout())).toMatchObject({ ok: false, exitCode: 1 });
  });

  it("refuses a non-empty output directory before rendering (exit 1)", async () => {
    const out = tempDir("export-dirty-");
    writeFileSync(path.join(out, "old.mp4"), "x");
    const { deps, io } = makeDeps();
    expect(await runCli(["export", fixturePath("valid-flow.json"), "--out", out, "--json"], deps)).toBe(1);
    expect((parseStdoutJson(io.stdout()) as { error: string }).error).toMatch(/not empty/);
  });

  it("reports a missing ffmpeg as an environment failure (exit 3)", async () => {
    const previous = { FFMPEG_PATH: process.env.FFMPEG_PATH };
    process.env.FFMPEG_PATH = path.join(tempDir("export-noff-"), "missing-ffmpeg");
    try {
      const { deps, io } = makeDeps();
      const out = path.join(tempDir("export-out-"), "run");
      expect(await runCli(["export", fixturePath("valid-flow.json"), "--out", out, "--json"], deps)).toBe(3);
      expect((parseStdoutJson(io.stdout()) as { error: string }).error).toMatch(/FFMPEG_PATH/);
    } finally {
      if (previous.FFMPEG_PATH === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = previous.FFMPEG_PATH;
    }
  });

  it("documents export in help", async () => {
    const { deps, io } = makeDeps();
    expect(await runCli(["export", "--help"], deps)).toBe(0);
    expect(io.stdout()).toContain("--formats mp4,gif,poster");
    expect(io.stdout()).toContain("FFMPEG_PATH");
  });
});

describe("ffmpeg resolution", () => {
  it("prefers FFMPEG_PATH, then PATH, then ffmpeg-static", () => {
    const envBin = fakeBinary(tempDir("ff-env-"), "custom-ffmpeg");
    const pathDir = tempDir("ff-path-");
    const pathBin = fakeBinary(pathDir);
    const staticBin = fakeBinary(tempDir("ff-static-"));
    const staticPath = () => staticBin;
    expect(resolveFfmpeg({ env: { FFMPEG_PATH: envBin, PATH: pathDir }, staticPath })).toEqual({ path: envBin, source: "FFMPEG_PATH" });
    expect(resolveFfmpeg({ env: { PATH: `/nonexistent:${pathDir}` }, staticPath })).toEqual({ path: pathBin, source: "PATH" });
    expect(resolveFfmpeg({ env: { PATH: "/nonexistent" }, staticPath })).toEqual({ path: staticBin, source: "ffmpeg-static" });
  });

  it("fails with exit 3 when nothing is available or FFMPEG_PATH is wrong", () => {
    const dir = tempDir("ff-none-");
    const notExecutable = path.join(dir, "ffmpeg");
    writeFileSync(notExecutable, "");
    chmodSync(notExecutable, 0o644);
    expect(exitCodeOf(() => resolveFfmpeg({ env: { PATH: dir }, staticPath: () => null }))).toBe(3);
    expect(exitCodeOf(() => resolveFfmpeg({ env: { FFMPEG_PATH: notExecutable, PATH: "" }, staticPath: () => null }))).toBe(3);
    expect(exitCodeOf(() => resolveFfmpeg({ env: { FFMPEG_PATH: dir }, staticPath: () => null }))).toBe(3);
  });

  it("finds the bundled ffmpeg-static binary in this checkout", () => {
    expect(resolveFfmpeg({ env: { PATH: "" } }).source).toBe("ffmpeg-static");
  });
});

describe("frame schedule and encoder arguments", () => {
  it("covers timeline plus tail and captures the held tail once", () => {
    const schedule = frameSchedule(7900, 1200, 30);
    expect(schedule.frames).toBe(273);
    expect(schedule.repeats.reduce((sum, count) => sum + count, 0)).toBe(273);
    expect(schedule.unique[0]).toBe(0);
    expect(schedule.unique[1]).toBe(33);
    expect(schedule.unique[schedule.unique.length - 1]).toBe(7900);
    expect(schedule.repeats[schedule.repeats.length - 1]).toBe(273 - 237);
    expect(frameSchedule(0, 0, 30)).toEqual({ frames: 1, unique: [0], repeats: [1] });
  });

  it("encodes H.264 yuv420p, even dimensions, faststart, constant rate, and no audio by default", () => {
    const args = mp4Args({ fps: 30, crf: 18, output: "/out/x.mp4", totalMs: 9100 });
    const joined = args.join(" ");
    expect(joined).toContain("-f image2pipe -framerate 30 -c:v png -i pipe:0");
    expect(joined).toContain("pad=ceil(iw/2)*2:ceil(ih/2)*2");
    expect(joined).toContain("-c:v libx264");
    expect(joined).toContain("-crf 18");
    expect(joined).toContain("-pix_fmt yuv420p");
    expect(joined).toContain("-r 30");
    expect(joined).toContain("-movflags +faststart");
    expect(joined).toContain("-t 9.100");
    expect(args).toContain("-an");
    expect(args[args.length - 1]).toBe("/out/x.mp4");
  });

  it("steps the GIF down by fps first, then width", () => {
    expect(gifSteps(15, 480)).toEqual([
      { fps: 15, width: 480 },
      { fps: 12, width: 480 },
      { fps: 10, width: 480 },
      { fps: 10, width: 400 },
      { fps: 8, width: 360 },
      { fps: 8, width: 320 },
    ]);
    expect(gifSteps(8, 300)).toEqual([{ fps: 8, width: 300 }]);
  });

  it("parses ffmpeg's banner and stream-copy summary", () => {
    const sample = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':",
      "  Duration: 00:00:09.10, start: 0.000000, bitrate: 189 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 804x1748 [SAR 1:1 DAR 201:437], 187 kb/s, 30 fps, 30 tbr, 15360 tbn (default)",
      "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 191 kb/s (default)",
      "frame=  273 fps=0.0 q=-1.0 Lsize=N/A time=00:00:09.06 bitrate=N/A speed=2.1e+03x",
    ].join("\n");
    expect(parseProbeOutput(sample)).toEqual({
      durationMs: 9100,
      width: 804,
      height: 1748,
      fps: 30,
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      hasAudio: true,
      frames: 273,
    });
  });
});

describe("audio plan", () => {
  const base = { id: "a", platform: "ios", theme: "light", durationMs: 6000, contact: { name: "A" }, nowMs: 0, screen: "conversation" } as const;

  it("has no audio track when the flow has no audible audio", () => {
    const compiled = { ...base, events: [] } as unknown as CompiledDemo;
    expect(planAudio(compiled, 7200, repoRoot).segments).toEqual([]);
    expect(audioFilterGraph([], 7200)).toBeNull();
  });

  it("places an audible clip from its play event until the next control", () => {
    const root = tempDir("export-audio-");
    mkdirSync(path.join(root, "public/demo-assets"), { recursive: true });
    writeFileSync(path.join(root, "public/demo-assets/voice.m4a"), "");
    const compiled = {
      ...base,
      events: [
        { type: "message", atMs: 500, message: { id: "m1", direction: "incoming", kind: "audio", audio: { duration: 6, src: "/demo-assets/voice.m4a" } } },
        { type: "audio-control", atMs: 1000, messageId: "m1", position: 0.5, playing: true },
        { type: "audio-control", atMs: 3000, messageId: "m1", position: 2.5, playing: false },
        { type: "audio-control", atMs: 4000, messageId: "m1", position: 2.5, playing: true },
      ],
    } as unknown as CompiledDemo;
    const plan = planAudio(compiled, 7200, root);
    expect(plan.segments).toEqual([
      { messageId: "m1", file: path.join(root, "public/demo-assets/voice.m4a"), startMs: 1000, offsetSeconds: 0.5, durationMs: 2000 },
      { messageId: "m1", file: path.join(root, "public/demo-assets/voice.m4a"), startMs: 4000, offsetSeconds: 2.5, durationMs: 3200 },
    ]);
    const graph = audioFilterGraph(plan.segments, 7200)!;
    expect(graph.inputs).toEqual(["-i", path.join(root, "public/demo-assets/voice.m4a")]);
    expect(graph.filter).toContain("[1:a]atrim=start=0.500:duration=2.000");
    expect(graph.filter).toContain("adelay=4000:all=1[s1]");
    expect(graph.filter).toContain("amix=inputs=2:normalize=0");
    expect(graph.filter).toContain("atrim=0:7.200[aout]");
    expect(mp4Args({ fps: 30, crf: 18, output: "o.mp4", totalMs: 7200, audio: graph })).toEqual(expect.arrayContaining(["-c:a", "aac"]));
  });

  it("skips audio sources outside public/", () => {
    const compiled = {
      ...base,
      events: [
        { type: "message", atMs: 0, message: { id: "m1", direction: "incoming", kind: "audio", audio: { duration: 3, src: "https://example.com/a.mp3" } } },
        { type: "audio-control", atMs: 0, messageId: "m1", position: 0, playing: true },
      ],
    } as unknown as CompiledDemo;
    const plan = planAudio(compiled, 4000, repoRoot);
    expect(plan.segments).toEqual([]);
    expect(plan.warnings[0]).toMatch(/not a local/);
  });
});
