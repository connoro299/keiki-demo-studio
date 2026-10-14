import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { registerCleanup } from "@/cli/cleanup";
import { loadAuthoring, loadAuthoringValue, type LoadedDocument } from "@/cli/commands/core";
import { bootPlayerHost } from "@/cli/commands/preview";
import { openCaptureSession, screenshotFramePng, seekReady, demoFrame, type CaptureSession } from "@/cli/capture/engine";
import { loadDeps, type CliDeps } from "@/cli/deps";
import { CliError, EXIT_ENVIRONMENT, EXIT_USAGE } from "@/cli/errors";
import { imageSize, sniffImage } from "@/cli/preflight";
import type { DemoFlow, DemoPlatform, DemoTheme } from "@/contracts";
import { audioFilterGraph, planAudio } from "@/export/audio";
import { probeMedia, resolveFfmpeg, runFfmpeg, spawnFfmpeg, type FfmpegProcess, type ResolvedFfmpeg } from "@/export/ffmpeg";
import { EXPORT_FORMATS, type ExportFormat, type ExportOptions, type ExportResult } from "@/export/index";

export const EXPORT_DEFAULTS = {
  formats: ["mp4", "gif", "poster"] as ExportFormat[],
  fps: 30,
  scale: 2,
  tailMs: 1200,
  gifWidth: 480,
  gifFps: 15,
  maxGifBytes: 5 * 1024 * 1024,
  crf: 18,
};

/**
 * Render a flow to MP4 / GIF / poster PNG by seeking the same deterministic player `capture`
 * uses: seek(t) -> ready(revision) -> screenshot [data-demo-frame], one frame per tick, piped
 * straight into ffmpeg. Renderer-agnostic: anything the player renders, export encodes.
 *
 * `flow` is a path to a flow JSON file or an in-memory DemoFlow (plus optional authoring fields).
 */
export async function exportVideo(flow: string | DemoFlow, options: ExportOptions): Promise<ExportResult> {
  const silent = { write() { /* library callers read the result instead */ } };
  const deps = await loadDeps({ io: { stdout: silent, stderr: silent } });
  return exportVideoWithDeps(flow, options, deps);
}

type Normalized = Required<Omit<ExportOptions, "platform" | "theme" | "port" | "onProgress" | "concurrency">> & {
  platform?: DemoPlatform;
  theme?: DemoTheme;
  port?: number;
  concurrency: number;
  onProgress?: ExportOptions["onProgress"];
};

export function normalizeExportOptions(options: ExportOptions): Normalized {
  const formats = [...new Set(options.formats ?? EXPORT_DEFAULTS.formats)];
  if (formats.length === 0) throw new CliError("--formats needs at least one of mp4, gif, poster", EXIT_USAGE);
  for (const format of formats) {
    if (!EXPORT_FORMATS.includes(format)) throw new CliError(`Unknown export format: ${String(format)} (use mp4, gif, poster)`, EXIT_USAGE);
  }
  const fps = options.fps ?? EXPORT_DEFAULTS.fps;
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new CliError("--fps must be an integer from 1 to 120", EXIT_USAGE);
  const scale = options.scale ?? EXPORT_DEFAULTS.scale;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new CliError("--scale must be greater than 0 and at most 4", EXIT_USAGE);
  const tailMs = options.tailMs ?? EXPORT_DEFAULTS.tailMs;
  if (!Number.isInteger(tailMs) || tailMs < 0) throw new CliError("--tail-ms must be a non-negative integer", EXIT_USAGE);
  const gifWidth = options.gifWidth ?? EXPORT_DEFAULTS.gifWidth;
  if (!Number.isInteger(gifWidth) || gifWidth < 16) throw new CliError("--gif-width must be an integer of at least 16", EXIT_USAGE);
  const gifFps = options.gifFps ?? EXPORT_DEFAULTS.gifFps;
  if (!Number.isInteger(gifFps) || gifFps < 1 || gifFps > 50) throw new CliError("--gif-fps must be an integer from 1 to 50", EXIT_USAGE);
  const maxGifBytes = options.maxGifBytes ?? EXPORT_DEFAULTS.maxGifBytes;
  if (!Number.isFinite(maxGifBytes) || maxGifBytes < 0) throw new CliError("maxGifBytes must be non-negative", EXIT_USAGE);
  const crf = options.crf ?? EXPORT_DEFAULTS.crf;
  if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new CliError("--crf must be an integer from 0 to 51", EXIT_USAGE);
  const concurrency = options.concurrency ?? defaultConcurrency();
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new CliError("--concurrency must be an integer from 1 to 16", EXIT_USAGE);
  if (!options.outDir) throw new CliError("Missing output directory", EXIT_USAGE);
  return {
    outDir: path.resolve(options.outDir),
    formats,
    fps,
    scale,
    tailMs,
    gifWidth,
    gifFps,
    maxGifBytes,
    crf,
    concurrency,
    gpu: options.gpu ?? false,
    dedupe: options.dedupe ?? true,
    platform: options.platform,
    theme: options.theme,
    port: options.port,
    onProgress: options.onProgress,
  };
}

function defaultConcurrency(): number {
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/** Frame i of n sits at round(i * 1000 / fps); everything past the timeline holds its last frame. */
export function frameSchedule(timelineMs: number, tailMs: number, fps: number): { frames: number; unique: number[]; repeats: number[] } {
  const totalMs = timelineMs + tailMs;
  const frames = Math.max(1, Math.round((totalMs * fps) / 1000));
  const unique: number[] = [];
  const repeats: number[] = [];
  for (let index = 0; index < frames; index += 1) {
    const atMs = Math.min(Math.round((index * 1000) / fps), timelineMs);
    if (unique[unique.length - 1] === atMs) repeats[repeats.length - 1]! += 1;
    else {
      unique.push(atMs);
      repeats.push(1);
    }
  }
  return { frames, unique, repeats };
}

export function mp4Args(input: { fps: number; crf: number; output: string; totalMs: number; audio?: { inputs: string[]; filter: string; label: string } | null }): string[] {
  const video = "[0:v]pad=ceil(iw/2)*2:ceil(ih/2)*2,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]";
  const filter = input.audio ? `${video};${input.audio.filter}` : video;
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(input.fps), "-c:v", "png", "-i", "pipe:0",
    ...(input.audio?.inputs ?? []),
    "-filter_complex", filter,
    "-map", "[vout]",
    ...(input.audio ? ["-map", input.audio.label, "-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-c:v", "libx264", "-preset", "medium", "-crf", String(input.crf),
    "-pix_fmt", "yuv420p", "-r", String(input.fps),
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    "-t", (input.totalMs / 1000).toFixed(3),
    "-movflags", "+faststart",
    input.output,
  ];
}

export function gifSteps(fps: number, width: number): { fps: number; width: number }[] {
  const steps = [
    { fps, width },
    { fps: Math.min(fps, 12), width },
    { fps: Math.min(fps, 10), width },
    { fps: Math.min(fps, 10), width: Math.min(width, 400) },
    { fps: Math.min(fps, 8), width: Math.min(width, 360) },
    { fps: Math.min(fps, 8), width: Math.min(width, 320) },
  ];
  return steps.filter((step, index) => index === 0 || steps.slice(0, index).every((prior) => prior.fps !== step.fps || prior.width !== step.width));
}

function gpuArgs(): string[] {
  return process.platform === "darwin"
    ? ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]
    : ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"];
}

/** Exports never overwrite: the output directory must be missing or empty. */
export function assertFreshOutDir(outDir: string): void {
  if (!existsSync(outDir)) return;
  if (!statSync(outDir).isDirectory()) throw new CliError(`Output path is not a directory: ${outDir}`, EXIT_USAGE);
  if (readdirSync(outDir).length > 0) throw new CliError(`Output directory is not empty: ${outDir}. Use a fresh --out for each export.`, EXIT_USAGE);
}

function loadFlow(flow: string | DemoFlow, options: Normalized, deps: CliDeps): LoadedDocument {
  const args = { platform: options.platform, humanRequest: undefined, sheetExperience: undefined };
  const loaded = typeof flow === "string"
    ? loadAuthoring({ ...args, file: resolveFlowPath(flow, deps.repoRoot) }, deps)
    : loadAuthoringValue(flow, `${flow.id ?? "flow"}.json`, args, deps);
  if (!options.theme) return loaded;
  return { ...loaded, document: { ...loaded.document, theme: options.theme } };
}

/** Absolute, cwd-relative, or repo-relative (e.g. "examples/x.flow.json" from any cwd). */
export function resolveFlowPath(flow: string, repoRoot: string): string {
  if (path.isAbsolute(flow)) return flow;
  const fromCwd = path.resolve(flow);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRepo = path.resolve(repoRoot, flow);
  return existsSync(fromRepo) ? fromRepo : fromCwd;
}

type Shooter = () => Promise<Buffer>;

/**
 * A raw CDP screenshot of the frame's clip. Equivalent pixels to Playwright's element screenshot
 * (verified bit-identical), at a fraction of the cost: no per-shot font wait or style injection.
 */
async function frameShooter(page: Page, session: CaptureSession, clip: { x: number; y: number; width: number; height: number }): Promise<Shooter> {
  // Playwright's screenshot hides the caret per shot; hide it once for the whole export.
  await page.addStyleTag({ content: "*, *::before, *::after { caret-color: transparent !important; }" });
  const cdp = await page.context().newCDPSession(page);
  // Emulation is per CDP session; mirror the context's metrics so the capture is at device scale.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: session.profile.width,
    height: session.profile.height,
    screenWidth: session.profile.width,
    screenHeight: session.profile.height,
    deviceScaleFactor: session.dpr,
    mobile: false,
  });
  return async () => {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: { ...clip, scale: 1 },
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    return Buffer.from(data, "base64");
  };
}

/**
 * A fingerprint of everything that decides the frame's pixels: its DOM (minus the per-seek
 * `data-time` / `data-revision` bookkeeping), scroll offsets, and every animation's progress.
 * Two timestamps with equal fingerprints paint identical pixels, so the second skips the
 * screenshot. Media the DOM cannot describe (video, canvas, iframes) opts the frame out (null).
 */
export function frameFingerprint(): string | null {
  const root = document.querySelector("[data-demo-frame]");
  if (!root || root.querySelector("video, canvas, iframe, object, embed")) return null;
  let text = root.outerHTML.replace(/\sdata-(?:time|revision)="[^"]*"/g, "");
  text += `|w${window.scrollX},${window.scrollY}`;
  for (const element of root.querySelectorAll("*")) {
    if (element.scrollTop || element.scrollLeft) text += `|${element.scrollTop},${element.scrollLeft}`;
  }
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getComputedTiming();
    text += `|${animation.playState}:${timing?.progress ?? "-"}:${timing?.currentIteration ?? "-"}`;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

const SAME_AS_PREVIOUS = Symbol("same-as-previous");

/**
 * Seek/screenshot on `pages` in parallel, hand buffers to `write` strictly in timeline order.
 * Workers stay within a bounded window ahead of the writer, so memory stays flat.
 * Returns how many screenshots were actually taken.
 */
async function renderFrames(input: {
  pages: { page: Page; shoot: Shooter }[];
  unique: number[];
  repeats: number[];
  expected: { theme: DemoTheme; platform: DemoPlatform };
  size: { width: number; height: number };
  dedupe: boolean;
  write: (buffer: Buffer) => Promise<void>;
  progress: (written: number) => void;
}): Promise<{ captured: number }> {
  const results = new Map<number, Buffer | typeof SAME_AS_PREVIOUS>();
  const fingerprints = new Map<number, string | null>();
  const window = input.pages.length * 3;
  let nextTake = 0;
  let nextWrite = 0;
  let captured = 0;
  let failure: unknown;
  let waiters: (() => void)[] = [];
  const notify = () => {
    const list = waiters;
    waiters = [];
    for (const wake of list) wake();
  };
  const changed = () => new Promise<void>((resolve) => waiters.push(resolve));

  const worker = async ({ page, shoot }: { page: Page; shoot: Shooter }) => {
    while (failure === undefined) {
      const index = nextTake;
      if (index >= input.unique.length) return;
      nextTake += 1;
      while (index - nextWrite >= window && failure === undefined) await changed();
      if (failure !== undefined) return;
      await seekReady(page, input.unique[index]!, input.expected);
      if (input.dedupe) {
        const fingerprint = await page.evaluate(frameFingerprint);
        fingerprints.set(index, fingerprint);
        notify();
        if (fingerprint !== null && index > 0) {
          while (!fingerprints.has(index - 1) && failure === undefined) await changed();
          if (fingerprints.get(index - 1) === fingerprint) {
            results.set(index, SAME_AS_PREVIOUS);
            notify();
            continue;
          }
        }
      }
      const buffer = await shoot();
      captured += 1;
      if (sniffImage(buffer) !== "png") throw new CliError("Frame capture is not a PNG", EXIT_ENVIRONMENT);
      const size = imageSize(buffer, "png");
      if (size.width !== input.size.width || size.height !== input.size.height) {
        throw new CliError(`Frame ${index} is ${size.width}x${size.height}, expected ${input.size.width}x${input.size.height}`, EXIT_ENVIRONMENT);
      }
      results.set(index, buffer);
      notify();
    }
  };
  const writer = async () => {
    let written = 0;
    let previous: Buffer | undefined;
    for (let index = 0; index < input.unique.length; index += 1) {
      while (!results.has(index)) {
        if (failure !== undefined) return;
        await changed();
      }
      const entry = results.get(index)!;
      results.delete(index);
      const buffer = entry === SAME_AS_PREVIOUS ? previous : entry;
      if (!buffer) throw new CliError(`Frame ${index} has no pixels`, EXIT_ENVIRONMENT);
      previous = buffer;
      for (let repeat = 0; repeat < input.repeats[index]!; repeat += 1) {
        await input.write(buffer);
        written += 1;
        input.progress(written);
      }
      nextWrite = index + 1;
      fingerprints.delete(index - 1);
      notify();
    }
  };
  const guard = (task: Promise<void>) => task.catch((error) => {
    if (failure === undefined) failure = error;
    notify();
  });
  await Promise.all([...input.pages.map((page) => guard(worker(page))), guard(writer())]);
  if (failure !== undefined) throw failure;
  return { captured };
}

async function encodeGif(input: {
  ffmpeg: string;
  source: string;
  output: string;
  workDir: string;
  fps: number;
  width: number;
  maxBytes: number;
  warnings: string[];
}): Promise<{ fps: number; width: number }> {
  const palette = path.join(input.workDir, "palette.png");
  let chosen = { fps: input.fps, width: input.width };
  const steps = gifSteps(input.fps, input.width);
  for (const [index, step] of steps.entries()) {
    const base = `fps=${step.fps},scale=${step.width}:-2:flags=lanczos:in_color_matrix=bt709:in_range=tv`;
    await runFfmpeg(input.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", input.source, "-vf", `${base},palettegen=max_colors=256`, palette]);
    await runFfmpeg(input.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y", "-i", input.source, "-i", palette,
      "-lavfi", `${base}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      "-loop", "0", input.output,
    ]);
    chosen = step;
    const bytes = statSync(input.output).size;
    if (input.maxBytes === 0 || bytes <= input.maxBytes) break;
    const next = steps[index + 1];
    const size = `${(bytes / 1048576).toFixed(1)} MB`;
    const budget = `${(input.maxBytes / 1048576).toFixed(1)} MB`;
    if (next) input.warnings.push(`GIF ${size} at ${step.fps}fps/${step.width}px is over the ${budget} budget; retrying at ${next.fps}fps/${next.width}px`);
    else input.warnings.push(`GIF is ${size} at ${step.fps}fps/${step.width}px, still over the ${budget} budget; shorten the flow or pass a smaller --gif-width`);
  }
  return chosen;
}

/** `exportVideo` with explicit CLI dependencies (validator/compiler doubles, repo root, injected preview server). */
export async function exportVideoWithDeps(flow: string | DemoFlow, rawOptions: ExportOptions, deps: CliDeps): Promise<ExportResult> {
  const started = performance.now();
  const options = normalizeExportOptions(rawOptions);
  assertFreshOutDir(options.outDir);
  const loaded = loadFlow(flow, options, deps);
  const ffmpeg: ResolvedFfmpeg = resolveFfmpeg();
  mkdirSync(options.outDir, { recursive: true });

  const host = await bootPlayerHost(
    { catalogue: false, port: options.port, file: loaded.file, platform: options.platform, humanRequest: undefined, sheetExperience: undefined },
    deps,
    { clean: true, loaded },
  );
  const unregisterHost = registerCleanup(() => host.close());
  const workDir = mkdtempSync(path.join(os.tmpdir(), "imessage-demo-export-"));
  const created: string[] = [];
  let session: CaptureSession | undefined;
  let encoder: FfmpegProcess | undefined;

  try {
    const compiled = host.manifest.compiled;
    if (!compiled) throw new CliError("Export needs a compiled flow", EXIT_USAGE);
    const { platform, theme } = host.manifest;
    const scenarioId = host.manifest.approvedScenarioId;
    const timelineMs = compiled.durationMs;
    const wantMp4 = options.formats.includes("mp4");
    const wantGif = options.formats.includes("gif");
    const wantPoster = options.formats.includes("poster");
    const warnings: string[] = [];
    let gifFps = options.gifFps;
    if (wantMp4 && gifFps > options.fps) {
      warnings.push(`GIF fps ${gifFps} is above the MP4 fps ${options.fps}; using ${options.fps}`);
      gifFps = options.fps;
    }
    // A GIF-only export renders the master at the GIF rate; nothing else needs more frames.
    const masterFps = wantMp4 ? options.fps : gifFps;
    const schedule = frameSchedule(timelineMs, options.tailMs, masterFps);
    const totalMs = timelineMs + options.tailMs;
    const base = path.join(options.outDir, scenarioId);
    const mp4Path = wantMp4 ? `${base}.mp4` : undefined;
    const gifPath = wantGif ? `${base}.gif` : undefined;
    const posterPath = wantPoster ? `${base}-poster.png` : undefined;

    session = await openCaptureSession({
      repoRoot: deps.repoRoot,
      origin: host.url,
      scenarioId,
      platform,
      theme,
      dpr: options.scale,
      launchArgs: options.gpu ? gpuArgs() : undefined,
    });
    const expected = { theme, platform };
    await seekReady(session.page, 0, expected);
    const frame = demoFrame(session.page);
    await frame.waitFor({ state: "visible", timeout: 15_000 });
    const box = await frame.boundingBox();
    if (!box) throw new CliError("Frame element has no box", EXIT_ENVIRONMENT);
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    const size = { width: Math.round(box.width * options.scale), height: Math.round(box.height * options.scale) };

    let framesMs = 0;
    let capturedFrames = 0;
    let masterPath: string | undefined;
    let audio = false;
    if (wantMp4 || wantGif) {
      const framesStarted = performance.now();
      const plan = wantMp4 ? planAudio(compiled, totalMs, deps.repoRoot) : { segments: [], warnings: [] };
      warnings.push(...plan.warnings);
      const audioGraph = audioFilterGraph(plan.segments, totalMs);
      audio = audioGraph !== null;
      masterPath = mp4Path ?? path.join(workDir, "master.mp4");
      if (mp4Path) created.push(mp4Path);
      const workers = Math.min(options.concurrency, schedule.unique.length);
      const pages: Page[] = [session.page];
      while (pages.length < workers) pages.push(await session.openPage());
      const shooters = [];
      for (const page of pages) shooters.push({ page, shoot: await frameShooter(page, session, clip) });
      encoder = spawnFfmpeg(ffmpeg.path, mp4Args({ fps: masterFps, crf: options.crf, output: masterPath, totalMs, audio: audioGraph }));
      const active = encoder;
      const rendered = await renderFrames({
        pages: shooters,
        dedupe: options.dedupe,
        unique: schedule.unique,
        repeats: schedule.repeats,
        expected,
        size,
        write: (buffer) => active.write(buffer),
        progress: (written) => options.onProgress?.({ frame: written, frames: schedule.frames }),
      });
      await active.finish();
      encoder = undefined;
      capturedFrames = rendered.captured;
      framesMs = performance.now() - framesStarted;
    }

    let posterMs = 0;
    if (posterPath) {
      const posterStarted = performance.now();
      created.push(posterPath);
      await seekReady(session.page, timelineMs, expected);
      await screenshotFramePng(session.page, posterPath, options.scale);
      posterMs = performance.now() - posterStarted;
    }

    if (session.blocked.length > 0) {
      throw new CliError("External network request during export", EXIT_ENVIRONMENT, { blocked: session.blocked });
    }
    const environment = await session.environment();
    await session.close();
    session = undefined;

    let gifMs = 0;
    let gifSettings: { fps: number; width: number } | undefined;
    if (gifPath && masterPath) {
      const gifStarted = performance.now();
      created.push(gifPath);
      gifSettings = await encodeGif({
        ffmpeg: ffmpeg.path,
        source: masterPath,
        output: gifPath,
        workDir,
        fps: gifFps,
        width: options.gifWidth,
        maxBytes: options.maxGifBytes,
        warnings,
      });
      gifMs = performance.now() - gifStarted;
    }

    const files: ExportResult["files"] = {};
    if (mp4Path) {
      const probe = await probeMedia(ffmpeg.path, mp4Path);
      files.mp4 = { path: mp4Path, bytes: statSync(mp4Path).size, width: probe.width, height: probe.height, fps: probe.fps, frames: probe.frames, durationMs: probe.durationMs };
    }
    if (gifPath && gifSettings) {
      const probe = await probeMedia(ffmpeg.path, gifPath);
      files.gif = { path: gifPath, bytes: statSync(gifPath).size, width: probe.width, height: probe.height, fps: gifSettings.fps, frames: probe.frames, durationMs: probe.durationMs };
    }
    if (posterPath) {
      files.poster = { path: posterPath, bytes: statSync(posterPath).size, ...size };
    }

    const totalElapsed = performance.now() - started;
    const manifest = path.join(options.outDir, "manifest.json");
    const result: ExportResult = {
      ...(mp4Path ? { mp4: mp4Path } : {}),
      ...(gifPath ? { gif: gifPath } : {}),
      ...(posterPath ? { poster: posterPath } : {}),
      durationMs: totalMs,
      frames: schedule.frames,
      capturedFrames,
      timelineMs,
      tailMs: options.tailMs,
      fps: masterFps,
      scale: options.scale,
      scenarioId,
      platform,
      theme,
      audio,
      files,
      manifest,
      ffmpeg: { path: ffmpeg.path, source: ffmpeg.source },
      timings: {
        framesMs: Math.round(framesMs),
        gifMs: Math.round(gifMs),
        posterMs: Math.round(posterMs),
        totalMs: Math.round(totalElapsed),
        renderSecondsPerVideoSecond: Number((totalElapsed / Math.max(1, totalMs)).toFixed(2)),
      },
      warnings,
    };
    writeFileSync(
      manifest,
      `${JSON.stringify({ ok: true, ...result, source: loaded.file, concurrency: Math.min(options.concurrency, schedule.unique.length), gpu: options.gpu, environment }, null, 2)}\n`,
    );
    return result;
  } catch (error) {
    encoder?.kill();
    for (const file of created) rmSync(file, { force: true });
    const report = {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      payload: error instanceof CliError ? error.payload : undefined,
    };
    writeFileSync(path.join(options.outDir, "failure.json"), `${JSON.stringify(report, null, 2)}\n`);
    throw error instanceof CliError ? error : new CliError(report.reason, EXIT_ENVIRONMENT);
  } finally {
    await session?.close();
    unregisterHost();
    await host.close();
    rmSync(host.tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}
