import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { imageSize } from "@/cli/preflight";
import { probeMedia, resolveFfmpeg } from "@/export/ffmpeg";
import { exportVideo } from "@/export/video";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function available(): { browser: boolean; ffmpeg: string | null } {
  let ffmpeg: string | null = null;
  try {
    ffmpeg = resolveFfmpeg().path;
  } catch {
    ffmpeg = null;
  }
  let browser = false;
  try {
    browser = existsSync(chromium.executablePath());
  } catch {
    browser = false;
  }
  return { browser, ffmpeg };
}

const env = available();
const out = mkdtempSync(path.join(os.tmpdir(), "export-video-"));

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

// Real browser + real ffmpeg. Skips cleanly when the Playwright chromium build or ffmpeg is missing.
describe.skipIf(!env.browser || !env.ffmpeg)("exportVideo (real player + ffmpeg)", () => {
  it("exports MP4, GIF, and poster with the expected size and length", async () => {
    const result = await exportVideo("examples/typing-reactions.flow.json", { outDir: out, tailMs: 600, concurrency: 2 });
    const ffmpeg = env.ffmpeg!;
    const expectedMs = result.timelineMs + 600;
    expect(result.durationMs).toBe(expectedMs);
    expect(result.frames).toBe(Math.round((expectedMs * 30) / 1000));
    expect(result.audio).toBe(false);

    const mp4 = await probeMedia(ffmpeg, result.mp4!);
    expect(mp4.videoCodec).toBe("h264");
    expect(mp4.pixelFormat).toBe("yuv420p");
    expect([mp4.width, mp4.height]).toEqual([804, 1748]);
    expect(mp4.fps).toBe(30);
    expect(mp4.frames).toBe(result.frames);
    expect(Math.abs(mp4.durationMs - expectedMs)).toBeLessThanOrEqual(34);
    expect(mp4.hasAudio).toBe(false);

    const gif = await probeMedia(ffmpeg, result.gif!);
    expect(gif.videoCodec).toBe("gif");
    expect(gif.width).toBe(480);
    expect(Math.abs(gif.durationMs - expectedMs)).toBeLessThanOrEqual(100);
    expect(result.files.gif!.bytes).toBeLessThan(5 * 1024 * 1024);

    expect(imageSize(readFileSync(result.poster!), "png")).toEqual({ width: 804, height: 1748 });
    const manifest = JSON.parse(readFileSync(result.manifest, "utf8")) as { ok: boolean; frames: number };
    expect(manifest).toMatchObject({ ok: true, frames: result.frames });
  }, 300_000);
});
