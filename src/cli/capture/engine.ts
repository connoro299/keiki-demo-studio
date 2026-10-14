import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import profiles from "@/contracts/render-profiles.json";
import { imageSize, sniffImage } from "@/cli/preflight";
import { loadCaptureConstants, type CaptureConstants } from "@/cli/capture/environment";
import { assertReceipt, isAllowedCaptureUrl } from "@/cli/capture/network";
import { registerCleanup } from "@/cli/cleanup";
import { CliError, EXIT_ENVIRONMENT } from "@/cli/errors";
import { checkpointAt } from "@/player/controller";
import type { NamedCheckpoint, ReadyReceipt, SeekResult } from "@/player/types";
import type { DemoPlatform, DemoTheme } from "@/contracts";

export type CaptureSample = {
  atMs: number;
  checkpointId?: string;
  png: string;
  receipt: ReadyReceipt;
};

export type CaptureSuccess = {
  ok: true;
  samples: CaptureSample[];
  manifest: string;
  environment: Record<string, unknown>;
};

export type CaptureEngineInput = {
  repoRoot: string;
  origin: string;
  scenarioId: string;
  platform: DemoPlatform;
  theme: DemoTheme;
  outputDir: string;
  checkpoints: NamedCheckpoint[];
  atMs?: number;
  checkpoint?: string;
  frames?: boolean;
  intervalMs: number;
  durationMs: number;
};

export type CaptureSessionInput = {
  repoRoot: string;
  origin: string;
  scenarioId: string;
  platform: DemoPlatform;
  theme: DemoTheme;
  /** Override the device scale. Defaults to scripts/capture/constants.json for the platform. */
  dpr?: number;
  /** Extra Chromium flags (export's opt-in GPU raster). Capture passes none. */
  launchArgs?: string[];
};

/**
 * One locked-down headless browser context pointed at the local player. Shared by `capture`
 * and `export`: same locale, time zone, reduced motion, viewport, and local-origin-only network.
 */
export type CaptureSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  constants: CaptureConstants;
  profile: { width: number; height: number };
  dpr: number;
  /** URLs aborted because they left the local origin. Non-empty means the run must fail. */
  blocked: string[];
  /** Open another page on the same scenario (parallel seeking stays deterministic per timestamp). */
  openPage(): Promise<Page>;
  environment(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

export async function openCaptureSession(input: CaptureSessionInput): Promise<CaptureSession> {
  const constants = loadCaptureConstants(input.repoRoot);
  const profile = profiles[input.platform];
  const dpr = input.dpr ?? constants.dpr[input.platform];
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const blocked: string[] = [];
  const unregister = registerCleanup(async () => {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  });
  const close = async () => {
    unregister();
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  };

  try {
    try {
      browser = await chromium.launch({ headless: true, ...(input.launchArgs?.length ? { args: input.launchArgs } : {}) });
    } catch (error) {
      throw new CliError(`Browser launch failed: ${error instanceof Error ? error.message : String(error)}`, EXIT_ENVIRONMENT);
    }
    const launched = browser;
    const ctx = await launched.newContext({
      locale: constants.locale,
      timezoneId: constants.timeZone,
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: dpr,
      colorScheme: input.theme,
      reducedMotion: "reduce",
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
    });
    context = ctx;
    await ctx.route("**/*", async (route) => {
      const url = route.request().url();
      if (isAllowedCaptureUrl(url, input.origin)) {
        await route.continue();
        return;
      }
      blocked.push(url);
      await route.abort("blockedbyclient");
    });
    const target = `${input.origin}?scenario=${encodeURIComponent(input.scenarioId)}`;
    const openPage = async (): Promise<Page> => {
      const page = await ctx.newPage();
      page.on("download", () => {
        throw new CliError("External download blocked during capture", EXIT_ENVIRONMENT);
      });
      page.on("popup", () => {
        throw new CliError("External navigation blocked during capture", EXIT_ENVIRONMENT);
      });
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(() => Boolean(window.IMESSAGE_DEMO), { timeout: 15_000 });
      return page;
    };
    const page = await openPage();
    return {
      browser: launched,
      context: ctx,
      page,
      constants,
      profile,
      dpr,
      blocked,
      openPage,
      async environment() {
        const fonts = await page.evaluate(() => [...document.fonts].map((font) => font.family));
        return {
          browser: { name: "chromium", version: launched.version() },
          host: { platform: process.platform, arch: process.arch, node: process.version },
          fonts,
          locale: constants.locale,
          timeZone: constants.timeZone,
          reducedMotion: constants.reducedMotion,
          theme: input.theme,
          platform: input.platform,
          viewport: profile,
          dpr,
        };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** seek(t) then ready(revision); throws unless the receipt matches the request exactly. */
export async function seekReady(
  page: Page,
  atMs: number,
  expected: { theme: DemoTheme; platform: DemoPlatform },
): Promise<ReadyReceipt> {
  const seek = await page.evaluate(async (timeMs) => window.IMESSAGE_DEMO!.seek(timeMs), atMs) as SeekResult;
  const receipt = await page.evaluate(async (revision) => window.IMESSAGE_DEMO!.ready(revision), seek.revision) as ReadyReceipt;
  assertReceipt(receipt, { revision: seek.revision, timeMs: atMs, theme: expected.theme, platform: expected.platform });
  return receipt;
}

export function demoFrame(page: Page): Locator {
  return page.locator("[data-demo-frame]");
}

/** Screenshot [data-demo-frame] to a PNG and check its pixel size equals the CSS box times dpr. */
export async function screenshotFramePng(page: Page, pngPath: string, dpr: number): Promise<{ width: number; height: number }> {
  const frame = demoFrame(page);
  await frame.waitFor({ state: "visible", timeout: 15_000 });
  // Leave paused Web Animations at the seeked time. "disabled" finishes them and erases a mid-flight pose.
  await frame.screenshot({ path: pngPath, animations: "allow" });
  if (!existsSync(pngPath)) throw new CliError(`Capture did not write ${pngPath}`, EXIT_ENVIRONMENT);
  const pngBytes = readFileSync(pngPath);
  if (sniffImage(pngBytes) !== "png") throw new CliError("Capture output is not a PNG", EXIT_ENVIRONMENT);
  const size = imageSize(pngBytes, "png");
  const box = await frame.boundingBox();
  if (!box) throw new CliError("Frame element has no box", EXIT_ENVIRONMENT);
  const expected = { width: Math.round(box.width * dpr), height: Math.round(box.height * dpr) };
  if (size.width !== expected.width || size.height !== expected.height) {
    throw new CliError(
      `PNG size ${size.width}x${size.height} != ${expected.width}x${expected.height}`,
      EXIT_ENVIRONMENT,
    );
  }
  return size;
}

export async function runCaptureEngine(input: CaptureEngineInput): Promise<CaptureSuccess> {
  mkdirSync(input.outputDir, { recursive: true });
  const session = await openCaptureSession(input);
  const { page, dpr } = session;

  try {
    const times = sampleTimes(input);
    const samples: CaptureSample[] = [];
    for (const sample of times) {
      const receipt = await seekReady(page, sample.atMs, input);
      const pngName = times.length === 1 ? "frame.png" : `frame-${String(sample.atMs).padStart(6, "0")}.png`;
      const pngPath = path.join(input.outputDir, pngName);
      await screenshotFramePng(page, pngPath, dpr);
      samples.push({ atMs: sample.atMs, checkpointId: sample.checkpointId, png: pngPath, receipt });
    }

    if (session.blocked.length > 0) {
      throw new CliError("External network request during capture", EXIT_ENVIRONMENT, { blocked: session.blocked });
    }

    const environment = await session.environment();
    const manifestPath = path.join(input.outputDir, "manifest.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          ok: true,
          scenarioId: input.scenarioId,
          samples: samples.map((sample) => ({
            atMs: sample.atMs,
            checkpointId: sample.checkpointId,
            png: sample.png,
            receipt: sample.receipt,
          })),
          environment,
        },
        null,
        2,
      )}\n`,
    );
    return { ok: true, samples, manifest: manifestPath, environment };
  } finally {
    await session.close();
  }
}

function sampleTimes(input: CaptureEngineInput): { atMs: number; checkpointId?: string }[] {
  if (input.checkpoint) {
    const checkpoint = checkpointAt(input.checkpoints, input.checkpoint);
    return [{ atMs: checkpoint.atMs, checkpointId: checkpoint.id }];
  }
  if (input.frames) {
    const times: { atMs: number }[] = [];
    for (let atMs = 0; atMs <= input.durationMs; atMs += input.intervalMs) {
      times.push({ atMs });
    }
    if (times[times.length - 1]?.atMs !== input.durationMs) times.push({ atMs: input.durationMs });
    return times;
  }
  return [{ atMs: input.atMs ?? 0 }];
}
