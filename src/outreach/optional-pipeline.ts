import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DemoAsset, Lead } from "./types";

/**
 * The website→demo pipeline ("@/outreach/pipeline") ships on its own branch. Everything here that
 * wants it loads it lazily and degrades to "demo generation unavailable" when it is not present, so
 * the X queue and the dashboard work without it.
 */
export type PipelineModule = {
  analyzeSite?: (url: string, ...rest: unknown[]) => Promise<unknown>;
  generateDemos?: (...args: unknown[]) => Promise<unknown>;
  processLead?: (lead: Lead | string, ...rest: unknown[]) => Promise<Lead | void> | Lead | void;
  addLeads?: (urls: string[], ...rest: unknown[]) => Promise<unknown> | unknown;
  runQueue?: (...args: unknown[]) => Promise<unknown>;
};

export const PIPELINE_UNAVAILABLE = "demo generation unavailable: the outreach pipeline (src/outreach/pipeline.ts) is not installed on this branch";

export function pipelineInstalled(): boolean {
  try {
    return existsSync(fileURLToPath(new URL("./pipeline.ts", import.meta.url)));
  } catch {
    return false;
  }
}

/** True when the pipeline CLI (`npm run outreach`) exists. */
export function pipelineCliInstalled(): boolean {
  try {
    return existsSync(fileURLToPath(new URL("./cli.ts", import.meta.url)));
  } catch {
    return false;
  }
}

export async function loadPipeline(): Promise<PipelineModule | null> {
  if (!pipelineInstalled()) return null;
  // A variable specifier keeps bundlers and tsc from requiring the module at build time.
  const specifier = "./pipeline";
  try {
    return (await import(/* @vite-ignore */ specifier)) as PipelineModule;
  } catch (error) {
    throw new Error(`the outreach pipeline failed to load: ${(error as Error).message}`);
  }
}

/** Pick the best demo for a share: prefer one with an MP4, then iMessage, then whatever is first. */
export function bestDemo(demos: DemoAsset[] | undefined): DemoAsset | undefined {
  if (!demos?.length) return undefined;
  const withVideo = demos.filter((demo) => demo.mp4);
  const pool = withVideo.length ? withVideo : demos;
  return pool.find((demo) => demo.channel === "imessage") ?? pool[0];
}
