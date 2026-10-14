import path from "node:path";
import type { ParsedArgs } from "@/cli/args";
import type { CliDeps } from "@/cli/deps";
import { writeErr, writeJson, writeLine } from "@/cli/deps";
import { CliError, EXIT_OK, EXIT_USAGE } from "@/cli/errors";
import { exportVideoWithDeps } from "@/export/video";

export async function exportCommand(args: ParsedArgs, deps: CliDeps): Promise<number> {
  if (args.catalogue) throw new CliError("export renders a flow file; --catalogue is not supported", EXIT_USAGE);
  if (!args.file) throw new CliError("Missing demo JSON file", EXIT_USAGE);
  const outDir = path.resolve(args.out ?? path.join(deps.repoRoot, "artifacts/exports", `run-${process.pid}-${Date.now()}`));
  const run = deps.exportVideo ?? exportVideoWithDeps;
  let lastDecile = -1;
  const result = await run(
    args.file,
    {
      outDir,
      requireEmptyOutDir: true,
      formats: args.formats,
      fps: args.fps,
      scale: args.scale,
      tailMs: args.tailMs,
      gifWidth: args.gifWidth,
      gifFps: args.gifFps,
      crf: args.crf,
      maxDurationMs: args.maxDurationMs,
      concurrency: args.concurrency,
      gpu: args.gpu,
      dedupe: args.dedupe,
      platform: args.platform,
      theme: args.theme,
      port: args.port,
      onProgress: ({ frame, frames }) => {
        const decile = Math.floor((frame / frames) * 10);
        if (decile !== lastDecile) {
          lastDecile = decile;
          writeErr(deps.io, `export frames ${frame}/${frames}`);
        }
      },
    },
    deps,
  );
  for (const warning of result.warnings) writeErr(deps.io, `warning: ${warning}`);
  if (args.json) {
    writeJson(deps.io, { ok: true, ...result });
    return EXIT_OK;
  }
  for (const [format, file] of Object.entries(result.files)) {
    if (!file) continue;
    const timing = "durationMs" in file ? ` ${(file.durationMs / 1000).toFixed(2)}s @ ${file.fps}fps` : "";
    writeLine(deps.io, `${format} ${file.path} (${file.width}x${file.height}${timing}, ${formatBytes(file.bytes)})`);
  }
  writeLine(deps.io, `manifest ${result.manifest}`);
  writeErr(deps.io, `rendered ${(result.durationMs / 1000).toFixed(2)}s of video in ${(result.timings.totalMs / 1000).toFixed(1)}s (${result.timings.renderSecondsPerVideoSecond}s per video second)`);
  return EXIT_OK;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
