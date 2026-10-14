import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgs } from "@/cli/args";
import { runCli } from "@/cli/run";
import { makeDeps, parseStdoutJson } from "./helpers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("CLI help and capabilities", () => {
  it("prints global help", async () => {
    const { deps, io } = makeDeps();
    const code = await runCli(["--help"], deps);
    expect(code).toBe(0);
    expect(io.stdout()).toContain("Usage: npm run demo -- <command>");
    expect(io.stdout()).toContain("Exit codes:");
  });

  it("prints command help", async () => {
    const { deps, io } = makeDeps();
    expect(await runCli(["capture", "--help"], deps)).toBe(0);
    expect(io.stdout()).toContain("IMESSAGE_DEMO.seek/ready");
  });

  it("rejects unknown commands with exit 1", async () => {
    const { deps, io } = makeDeps();
    const code = await runCli(["explode", "--json"], deps);
    expect(code).toBe(1);
    expect(parseStdoutJson(io.stdout())).toMatchObject({ ok: false, exitCode: 1 });
  });

  it("prints the frozen capability manifest as one JSON object", async () => {
    const { deps, io } = makeDeps();
    const code = await runCli(["capabilities", "--json"], deps);
    expect(code).toBe(0);
    const payload = parseStdoutJson(io.stdout()) as { ok: boolean; unsupported: { id: string }[] };
    expect(payload.ok).toBe(true);
    expect(payload.unsupported.map((item) => item.id)).toEqual(["mini-apps", "native-call", "native-payment"]);
    expect(io.stdout().trim().split("\n")).toHaveLength(1);
  });

  it("parses capture flags", () => {
    expect(parseArgs(["capture", "demo.json", "--frames", "--interval-ms", "250", "--port", "4120"]).frames).toBe(true);
    expect(parseArgs(["capture", "demo.json", "--checkpoint", "after-reply"]).checkpoint).toBe("after-reply");
  });
});

describe("CLI spawn entry", { timeout: 60_000 }, () => {
  it("runs capabilities without doubles", async () => {
    const result = await spawnDemo(["capabilities", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout.trim()) as { unsupported: { id: string }[] };
    expect(payload.unsupported.map((item) => item.id)).toContain("mini-apps");
    expect(payload.unsupported.map((item) => item.id)).not.toContain("polls");
  });
});

function spawnDemo(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli/main.ts", ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
