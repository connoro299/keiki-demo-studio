import { generateCommand, planSheetCommand } from "@/cli/commands/generate";
import { parseArgs } from "@/cli/args";
import { captureCommand } from "@/cli/commands/capture";
import { exportCommand } from "@/cli/commands/export";
import { capabilitiesCommand, compileCommand, validateCommand } from "@/cli/commands/core";
import { previewCommand } from "@/cli/commands/preview";
import type { CliDeps } from "@/cli/deps";
import { writeErr, writeJson, writeLine } from "@/cli/deps";
import { CliError, EXIT_OK, EXIT_USAGE } from "@/cli/errors";
import { COMMAND_HELP, HELP } from "@/cli/help";

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let json = argv.includes("--json");
  try {
    const args = parseArgs(argv);
    json = args.json;
    if (args.help) {
      writeLine(deps.io, args.command === "help" ? HELP : COMMAND_HELP[args.command] ?? HELP);
      return EXIT_OK;
    }
    switch (args.command) {
      case "generate": return await generateCommand(args, deps);
      case "plan-sheet": return await planSheetCommand(args, deps);
      case "capabilities":
        return await capabilitiesCommand(args, deps);
      case "validate":
        return await validateCommand(args, deps);
      case "compile":
        return await compileCommand(args, deps);
      case "preview":
        return await previewCommand(args, deps);
      case "capture":
        return await captureCommand(args, deps);
      case "export":
        return await exportCommand(args, deps);
      default:
        writeLine(deps.io, HELP);
        return EXIT_USAGE;
    }
  } catch (error) {
    const exitCode = error instanceof CliError ? error.exitCode : EXIT_USAGE;
    const message = error instanceof Error ? error.message : String(error);
    const payload = error instanceof CliError ? error.payload : undefined;
    if (json) {
      writeJson(deps.io, { ok: false, exitCode, error: message, ...(payload ? { payload } : {}) });
    } else {
      writeErr(deps.io, message);
    }
    return exitCode;
  }
}
