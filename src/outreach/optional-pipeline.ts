import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DemoAsset } from "./types";

/**
 * The website→demo pipeline (src/outreach/pipeline.ts) pulls in site fetching, extraction and the
 * demo generator. The X queue and the dashboard API load it lazily, only when they need it, and
 * report "demo generation unavailable" instead of crashing if it cannot be loaded.
 */
export type PipelineModule = Pick<typeof import("./pipeline"), "addLeads" | "processLead">;

export const PIPELINE_UNAVAILABLE = "demo generation unavailable: the outreach pipeline (src/outreach/pipeline.ts) could not be loaded";

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
  try {
    return await import("./pipeline");
  } catch (error) {
    throw new Error(`${PIPELINE_UNAVAILABLE}: ${(error as Error).message}`);
  }
}

/** Pick the best demo for a share: prefer one with an MP4, then iMessage, then whatever is first. */
export function bestDemo(demos: DemoAsset[] | undefined): DemoAsset | undefined {
  if (!demos?.length) return undefined;
  const withVideo = demos.filter((demo) => demo.mp4);
  const pool = withVideo.length ? withVideo : demos;
  return pool.find((demo) => demo.channel === "imessage") ?? pool[0];
}
