import { CliError, EXIT_USAGE } from "@/cli/errors";
import type { DemoPlatform, DemoTheme } from "@/contracts";
import { EXPORT_FORMATS, type ExportFormat } from "@/export/index";

export type CliCommand = "capabilities" | "validate" | "compile" | "preview" | "capture" | "export" | "generate" | "plan-sheet" | "help";

export type ParsedArgs = {
  command: CliCommand;
  json: boolean;
  help: boolean;
  file?: string;
  humanRequest?: string;
  sheetExperience?: string;
  sheetPlan?: string;
  platform?: DemoPlatform;
  port?: number;
  out?: string;
  atMs?: number;
  checkpoint?: string;
  frames: boolean;
  intervalMs: number;
  catalogue: boolean;
  /** export only */
  formats?: ExportFormat[];
  fps?: number;
  theme?: DemoTheme;
  tailMs?: number;
  scale?: number;
  gifWidth?: number;
  gifFps?: number;
  crf?: number;
  concurrency?: number;
  gpu: boolean;
  dedupe: boolean;
};

const COMMANDS = new Set<CliCommand>(["capabilities", "validate", "compile", "preview", "capture", "export", "generate", "plan-sheet", "help"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (token === "-h" || token === "--help") {
      flags.help = true;
      continue;
    }
    if (token === "--json") {
      flags.json = true;
      continue;
    }
    if (token === "--frames") {
      flags.frames = true;
      continue;
    }
    if (token === "--catalogue") {
      flags.catalogue = true;
      continue;
    }
    if (token === "--gpu") {
      flags.gpu = true;
      continue;
    }
    if (token === "--no-dedupe") {
      flags.noDedupe = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const inline = eq === -1 ? undefined : token.slice(eq + 1);
      const value = inline ?? argv[index + 1];
      if (inline === undefined) index += 1;
      if (value === undefined || value.startsWith("--")) {
        throw new CliError(`Missing value for --${name}`, EXIT_USAGE);
      }
      flags[name] = value;
      continue;
    }
    positionals.push(token);
  }

  const commandToken = positionals[0] ?? "help";
  if (!COMMANDS.has(commandToken as CliCommand)) {
    throw new CliError(`Unknown command: ${commandToken}`, EXIT_USAGE);
  }

  return {
    command: commandToken as CliCommand,
    json: Boolean(flags.json),
    help: Boolean(flags.help) || commandToken === "help",
    file: positionals[1],
    humanRequest: optionalString(flags["human-request"]),
    sheetExperience: optionalString(flags["sheet-experience"]),
    sheetPlan: optionalString(flags["sheet-plan"]),
    platform: parsePlatform(flags.platform),
    port: parseNumber(flags.port, "port"),
    out: optionalString(flags.out),
    atMs: parseNumber(flags["at-ms"], "at-ms"),
    checkpoint: optionalString(flags.checkpoint),
    frames: Boolean(flags.frames),
    intervalMs: parseNumber(flags["interval-ms"], "interval-ms") ?? 1000,
    catalogue: Boolean(flags.catalogue),
    formats: parseFormats(flags.formats),
    fps: parsePositiveInteger(flags.fps, "fps"),
    theme: parseTheme(flags.theme),
    tailMs: parseNumber(flags["tail-ms"], "tail-ms"),
    scale: parseScale(flags.scale),
    gifWidth: parsePositiveInteger(flags["gif-width"], "gif-width"),
    gifFps: parsePositiveInteger(flags["gif-fps"], "gif-fps"),
    crf: parseNumber(flags.crf, "crf"),
    concurrency: parsePositiveInteger(flags.concurrency, "concurrency"),
    gpu: Boolean(flags.gpu),
    dedupe: !flags.noDedupe,
  };
}

function parseFormats(value: string | boolean | undefined): ExportFormat[] | undefined {
  if (value === undefined) return undefined;
  const formats = String(value).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (formats.length === 0) throw new CliError("--formats needs at least one of mp4, gif, poster", EXIT_USAGE);
  for (const format of formats) {
    if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
      throw new CliError(`--formats accepts mp4, gif, poster (got ${format})`, EXIT_USAGE);
    }
  }
  return [...new Set(formats)] as ExportFormat[];
}

function parseTheme(value: string | boolean | undefined): DemoTheme | undefined {
  if (value === undefined) return undefined;
  if (value === "light" || value === "dark") return value;
  throw new CliError("--theme must be light or dark", EXIT_USAGE);
}

function parsePositiveInteger(value: string | boolean | undefined, name: string): number | undefined {
  const parsed = parseNumber(value, name);
  if (parsed === 0) throw new CliError(`--${name} must be a positive integer`, EXIT_USAGE);
  return parsed;
}

function parseScale(value: string | boolean | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 4) {
    throw new CliError("--scale must be a number greater than 0 and at most 4", EXIT_USAGE);
  }
  return parsed;
}

function parsePlatform(value: string | boolean | undefined): DemoPlatform | undefined {
  if (value === undefined) return undefined;
  if (value === "ios" || value === "macos") return value;
  throw new CliError("--platform must be ios or macos", EXIT_USAGE);
}

function parseNumber(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError(`--${name} must be a non-negative integer`, EXIT_USAGE);
  }
  return parsed;
}

function optionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
