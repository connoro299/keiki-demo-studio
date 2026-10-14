import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CliError, EXIT_ENVIRONMENT } from "@/cli/errors";

export type FfmpegSource = "FFMPEG_PATH" | "PATH" | "ffmpeg-static";

export type ResolvedFfmpeg = { path: string; source: FfmpegSource };

export type ResolveFfmpegOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Returns the ffmpeg-static binary path (or null). Injectable for tests. */
  staticPath?: () => string | null | undefined;
};

/**
 * Resolution order: `FFMPEG_PATH` env -> `ffmpeg` on PATH -> the `ffmpeg-static` package.
 * An explicit FFMPEG_PATH that is not an executable file is an error, not a silent fallback.
 */
export function resolveFfmpeg(options: ResolveFfmpegOptions = {}): ResolvedFfmpeg {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const explicit = env.FFMPEG_PATH?.trim();
  if (explicit) {
    if (!isExecutableFile(explicit)) {
      throw new CliError(`FFMPEG_PATH is set but is not an executable file: ${explicit}`, EXIT_ENVIRONMENT);
    }
    return { path: path.resolve(explicit), source: "FFMPEG_PATH" };
  }
  const names = platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"];
  const pathVar = env.PATH ?? env.Path ?? "";
  for (const dir of pathVar.split(platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) return { path: candidate, source: "PATH" };
    }
  }
  const fromPackage = (options.staticPath ?? ffmpegStaticPath)();
  if (fromPackage && isExecutableFile(fromPackage)) return { path: fromPackage, source: "ffmpeg-static" };
  throw new CliError(
    "ffmpeg not found. Set FFMPEG_PATH, put ffmpeg on PATH, or run `npm ci` so the ffmpeg-static dependency downloads its binary.",
    EXIT_ENVIRONMENT,
  );
}

function ffmpegStaticPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require("ffmpeg-static") as string | null | { default?: string | null };
    return typeof resolved === "string" ? resolved : resolved?.default ?? null;
  } catch {
    return null;
  }
}

function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type FfmpegProcess = {
  child: ChildProcessWithoutNullStreams;
  /** Write one chunk to stdin, honoring backpressure. Rejects if ffmpeg has exited. */
  write(chunk: Buffer): Promise<void>;
  /** Close stdin (if open) and wait for a zero exit. */
  finish(): Promise<void>;
  kill(): void;
};

/** Spawn ffmpeg. Fails with EXIT_ENVIRONMENT and the tail of stderr on a non-zero exit. */
export function spawnFfmpeg(bin: string, args: string[]): FfmpegProcess {
  const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-6000);
  });
  child.stdout.resume();
  let exited = false;
  const exit = new Promise<void>((resolve, reject) => {
    child.on("error", (error) => {
      exited = true;
      reject(new CliError(`ffmpeg failed to start (${bin}): ${error.message}`, EXIT_ENVIRONMENT));
    });
    child.on("close", (code, signal) => {
      exited = true;
      if (code === 0) resolve();
      else reject(new CliError(`ffmpeg exited with ${code ?? signal}: ${stderr.trim().split("\n").slice(-8).join("\n")}`, EXIT_ENVIRONMENT));
    });
  });
  exit.catch(() => undefined);
  // EPIPE after an early ffmpeg exit surfaces through `exit`.
  child.stdin.on("error", () => undefined);
  return {
    child,
    async write(chunk) {
      if (exited || child.stdin.destroyed) {
        await exit;
        throw new CliError("ffmpeg closed its input early", EXIT_ENVIRONMENT);
      }
      if (!child.stdin.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => { cleanup(); resolve(); };
          const onClose = () => { cleanup(); exit.then(() => reject(new CliError("ffmpeg closed its input early", EXIT_ENVIRONMENT)), reject); };
          const cleanup = () => { child.stdin.off("drain", onDrain); child.off("close", onClose); };
          child.stdin.once("drain", onDrain);
          child.once("close", onClose);
        });
      }
    },
    async finish() {
      if (!child.stdin.destroyed) child.stdin.end();
      await exit;
    },
    kill() {
      if (!exited) child.kill("SIGKILL");
    },
  };
}

/** Run ffmpeg to completion with no stdin. */
export async function runFfmpeg(bin: string, args: string[]): Promise<void> {
  const proc = spawnFfmpeg(bin, args);
  await proc.finish();
}

export type MediaProbe = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  pixelFormat: string;
  hasAudio: boolean;
  /** Decoded-free frame count from stream copy (exact for MP4/GIF). */
  frames: number;
};

/**
 * Inspect a media file with ffmpeg alone (ffmpeg-static ships no ffprobe): parse the `-i` banner
 * for codec/size/fps/audio and stream-copy to null for the exact frame count and duration.
 */
export async function probeMedia(bin: string, file: string): Promise<MediaProbe> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ["-hide_banner", "-nostats", "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let text = "";
    child.stderr.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(text);
      else reject(new CliError(`ffmpeg could not read ${file}: ${text.trim().split("\n").slice(-3).join(" ")}`, EXIT_ENVIRONMENT));
    });
  });
  return parseProbeOutput(output);
}

export function parseProbeOutput(output: string): MediaProbe {
  const video = output.match(/Stream #0:\d+[^:]*: Video: (\w+)[^,]*, (\w+)(?:\([^)]*\))?,[^\n]*?(\d{2,5})x(\d{2,5})/);
  if (!video) throw new CliError("ffmpeg output has no video stream", EXIT_ENVIRONMENT);
  const fps = Number(output.match(/, ([\d.]+) fps/)?.[1] ?? output.match(/, ([\d.]+) tbr/)?.[1] ?? 0);
  // The stream-copy summary ("frame=  273 ... time=00:00:09.10") is the authoritative length.
  const frameMatches = [...output.matchAll(/frame=\s*(\d+)/g)];
  const frames = Number(frameMatches[frameMatches.length - 1]?.[1] ?? 0);
  const header = output.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const headerMs = header ? Math.round((Number(header[1]) * 3600 + Number(header[2]) * 60 + Number(header[3])) * 1000) : 0;
  return {
    durationMs: headerMs,
    width: Number(video[3]),
    height: Number(video[4]),
    fps,
    videoCodec: video[1]!,
    pixelFormat: video[2]!,
    hasAudio: /Stream #0:\d+[^:]*: Audio:/.test(output),
    frames,
  };
}
