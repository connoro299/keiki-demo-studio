import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ParsedArgs } from "@/cli/args";
import { compileDocument, loadAuthoring, type AuthoringArgs, type LoadedDocument } from "@/cli/commands/core";
import type { CliDeps } from "@/cli/deps";
import { writeErr, writeJson, writeLine } from "@/cli/deps";
import { CliError, EXIT_OK, EXIT_USAGE } from "@/cli/errors";
import { startPreviewServer, type PreviewHandle } from "@/cli/preview-server";
import { registerCleanup } from "@/cli/cleanup";
import type { DemoRunManifest } from "@/player/types";

export async function previewCommand(args: ParsedArgs, deps: CliDeps): Promise<number> {
  const handle = await bootPlayerHost(args, deps, { clean: false });
  registerCleanup(() => handle.close());
  const ready = { ok: true as const, url: handle.url, host: handle.host, port: handle.port };
  if (args.json) writeJson(deps.io, ready);
  else writeLine(deps.io, handle.url);
  writeErr(deps.io, `preview ready on ${handle.url}`);
  if (process.env.IMESSAGE_DEMO_PREVIEW_ONCE === "1") {
    await handle.close();
    return EXIT_OK;
  }
  await new Promise<void>(() => undefined);
  return EXIT_OK;
}

export async function bootPlayerHost(
  args: AuthoringArgs & Pick<ParsedArgs, "catalogue" | "port">,
  deps: CliDeps,
  options: { clean: boolean; loaded?: LoadedDocument },
): Promise<PreviewHandle & { manifestPath: string; tempDir: string; manifest: DemoRunManifest }> {
  const start = deps.startPreviewServer ?? startPreviewServer;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "imessage-demo-"));
  registerCleanup(async () => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  mkdirSync(tempDir, { recursive: true });

  let manifest: DemoRunManifest;
  if (args.catalogue) {
    manifest = {
      runId: path.basename(tempDir),
      mode: "catalogue",
      approvedScenarioId: "ios-text",
      compiled: null,
      checkpoints: [],
      clean: options.clean,
      theme: "light",
      platform: "ios",
    };
  } else {
    const loaded = options.loaded ?? loadAuthoring(args, deps);
    const artifacts = compileDocument(loaded, deps, path.join(tempDir, "compiled"));
    const artifact = artifacts[0];
    if (!artifact) throw new CliError("Compile produced no artifacts", EXIT_USAGE);
    manifest = {
      runId: path.basename(tempDir),
      mode: options.clean ? "capture" : "preview",
      approvedScenarioId: artifact.compiled.id,
      compiled: artifact.compiled,
      checkpoints: loaded.document.checkpoints ?? [],
      clean: options.clean,
      theme: artifact.compiled.theme,
      platform: artifact.compiled.platform,
    };
  }

  const manifestPath = path.join(tempDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  try {
    const handle = await start({
      repoRoot: deps.repoRoot,
      port: args.port,
      manifestPath,
    });
    return { ...handle, manifestPath, tempDir, manifest };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}
