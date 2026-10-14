import { sheetContext } from "@/cli/sheet-context";
import type { SheetValidationContext } from "@/generator/sheet-request";
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { authoringDocumentSchema, declaredTargets, toDemoFlow, type AuthoringDocument } from "@/cli/authoring";
import type { ParsedArgs } from "@/cli/args";
import type { CliDeps } from "@/cli/deps";
import { writeJson, writeLine } from "@/cli/deps";
import { CliError, EXIT_ENVIRONMENT, EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "@/cli/errors";
import { preflightAssets } from "@/cli/preflight";
import { findUnsupported } from "@/cli/unsupported";
import { sortValue } from "@/player/receipt";
import type { CompiledDemo, DemoPlatform, ValidationIssue } from "@/contracts";

export type LoadedDocument = {
  file: string;
  context?: SheetValidationContext;
  raw: unknown;
  document: AuthoringDocument;
  targets: DemoPlatform[];
};

/** The flags that shape how a flow is loaded and validated. */
export type AuthoringArgs = Pick<ParsedArgs, "file" | "platform" | "humanRequest" | "sheetExperience">;

export function loadAuthoring(args: AuthoringArgs, deps: CliDeps): LoadedDocument {
  if (!args.file) throw new CliError("Missing demo JSON file", EXIT_USAGE);
  const file = path.resolve(args.file);
  if (!existsSync(file)) throw new CliError(`Demo file not found: ${file}`, EXIT_ENVIRONMENT);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new CliError("Demo file is not valid JSON", EXIT_VALIDATION);
  }
  return loadAuthoringValue(raw, file, args, deps);
}

/** Same checks as loadAuthoring for an already-parsed document (`file` labels it in compiled output). */
export function loadAuthoringValue(
  raw: unknown,
  file: string,
  args: Omit<AuthoringArgs, "file">,
  deps: CliDeps,
): LoadedDocument {
  const unsupported = findUnsupported(raw);
  if (unsupported.length > 0) {
    throw new CliError("Unsupported features in demo file", EXIT_VALIDATION, { issues: unsupported });
  }
  const parsed = authoringDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((issue) => {
      const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys.filter((key): key is string => typeof key === "string") : [];
      return {
        path: issue.path.length > 0 ? issue.path.join(".") : keys[0] ?? "/",
        message: issue.message,
      };
    });
    throw new CliError("Demo file failed schema validation", EXIT_VALIDATION, { issues });
  }
  preflightAssets(parsed.data, deps.repoRoot);
  const targets = declaredTargets(parsed.data, args.platform);
  if (targets.length === 0) {
    throw new CliError("Requested platform is not a declared target", EXIT_VALIDATION, {
      issues: [{ path: "/targets", message: `PLATFORM_MISMATCH: ${args.platform ?? "requested"} is not declared` }],
    });
  }
  return {
    file,
    raw,
    context: sheetContext(args, deps.repoRoot),
    document: parsed.data,
    targets,
  };
}

export function validateDocument(
  loaded: LoadedDocument,
  deps: CliDeps,
): { ok: true; document: AuthoringDocument; targets: DemoPlatform[] } {
  const issues: ValidationIssue[] = [];
  for (const target of loaded.targets) {
    const result = deps.validateDemo(toDemoFlow(loaded.document, target), loaded.context);
    if (!result.ok) issues.push(...result.issues.map((issue) => ({ ...issue, path: `${target}.${issue.path}` })));
  }
  if (issues.length > 0) {
    throw new CliError("Demo validation failed", EXIT_VALIDATION, { issues });
  }
  return { ok: true, document: loaded.document, targets: loaded.targets };
}

export type CompiledArtifact = {
  platform: DemoPlatform;
  compiled: CompiledDemo;
  path: string;
};

export function compileDocument(loaded: LoadedDocument, deps: CliDeps, outDir: string): CompiledArtifact[] {
  validateDocument(loaded, deps);
  const planned = loaded.targets.map((target) => ({
    platform: target,
    compiled: deps.compileDemo(toDemoFlow(loaded.document, target), loaded.context),
  }));
  mkdirSync(outDir, { recursive: true });
  const artifacts: CompiledArtifact[] = [];
  for (const item of planned) {
    const fileName = planned.length > 1 ? `${item.compiled.id}.${item.platform}.json` : `${item.compiled.id}.json`;
    const dest = path.join(outDir, fileName);
    const payload = {
      compiled: item.compiled,
      checkpoints: loaded.document.checkpoints ?? [],
      target: item.platform,
      source: path.basename(loaded.file),
    };
    const body = `${JSON.stringify(sortValue(payload), null, 2)}\n`;
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, dest);
    artifacts.push({ platform: item.platform, compiled: item.compiled, path: dest });
  }
  return artifacts;
}

export async function capabilitiesCommand(args: ParsedArgs, deps: CliDeps): Promise<number> {
  const capabilities = JSON.parse(readFileSync(path.join(deps.repoRoot, "src/contracts/capabilities.json"), "utf8"));
  writeJson(deps.io, args.json ? { ok: true, ...capabilities } : capabilities);
  return EXIT_OK;
}

export async function validateCommand(args: ParsedArgs, deps: CliDeps): Promise<number> {
  const loaded = loadAuthoring(args, deps);
  const result = validateDocument(loaded, deps);
  if (args.json) writeJson(deps.io, { ok: true, id: result.document.id, targets: result.targets });
  else writeLine(deps.io, `ok ${result.document.id} targets=${result.targets.join(",")}`);
  return EXIT_OK;
}

export async function compileCommand(args: ParsedArgs, deps: CliDeps): Promise<number> {
  const loaded = loadAuthoring(args, deps);
  const outDir = path.resolve(args.out ?? path.join(deps.repoRoot, "artifacts/compiled"));
  const artifacts = compileDocument(loaded, deps, outDir);
  if (args.json) writeJson(deps.io, { ok: true, artifacts: artifacts.map((item) => item.path) });
  else for (const artifact of artifacts) writeLine(deps.io, artifact.path);
  return EXIT_OK;
}
