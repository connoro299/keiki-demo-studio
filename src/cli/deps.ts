import type { SheetValidationContext } from "@/generator/sheet-request";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CompiledDemo, DemoFlow, ValidationResult } from "@/contracts";

export type Io = {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
};

export type CliDeps = {
  validateDemo: (input: unknown, context?: SheetValidationContext) => ValidationResult;
  compileDemo: (demo: DemoFlow, context?: SheetValidationContext) => CompiledDemo;
  repoRoot: string;
  io: Io;
  startPreviewServer?: typeof import("@/cli/preview-server").startPreviewServer;
  runCaptureEngine?: typeof import("@/cli/capture/engine").runCaptureEngine;
  exportVideo?: typeof import("@/export/video").exportVideoWithDeps;
};

export function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export async function loadDeps(overrides: Partial<CliDeps> = {}): Promise<CliDeps> {
  const repoRoot = overrides.repoRoot ?? defaultRepoRoot();
  const io = overrides.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
  };
  if (process.env.IMESSAGE_DEMO_TEST_DOUBLES === "1") {
    const doubles = await import("../../tests/contracts/doubles");
    return {
      validateDemo: overrides.validateDemo ?? doubles.validateDemoDouble,
      compileDemo: overrides.compileDemo ?? doubles.compileDemoDouble,
      repoRoot,
      io,
      startPreviewServer: overrides.startPreviewServer,
      runCaptureEngine: overrides.runCaptureEngine,
      exportVideo: overrides.exportVideo,
    };
  }
  const compiler = await import("@/compiler");
  return {
    validateDemo: overrides.validateDemo ?? compiler.validateDemo,
    compileDemo: overrides.compileDemo ?? compiler.compileDemo,
    repoRoot,
    io,
    startPreviewServer: overrides.startPreviewServer,
    runCaptureEngine: overrides.runCaptureEngine,
    exportVideo: overrides.exportVideo,
  };
}

export function writeJson(io: Io, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value)}\n`);
}

export function writeLine(io: Io, line: string): void {
  io.stdout.write(`${line}\n`);
}

export function writeErr(io: Io, line: string): void {
  io.stderr.write(`${line}\n`);
}

export function readJsonFile(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}
