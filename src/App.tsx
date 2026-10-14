import { Suspense, lazy, useEffect, useState } from "react";
import { compileDemo, validateDemo } from "@/compiler";
import type { DemoFlow, ValidationIssue } from "@/contracts";
import { ShellPreview } from "@/foundation/ShellPreview";
import { PlayerHost, isCatalogueSceneId } from "@/player";
import { DemoPlayer } from "@/player/DemoPlayer";
import type { DemoRunManifest } from "@/player/types";

const scenarioModules = {
  ...(import.meta.glob("../scenarios/*.json", { eager: true, import: "default" }) as Record<string, DemoFlow>),
  ...(import.meta.glob("../examples/ios-poll-vote.flow.json", { eager: true, import: "default" }) as Record<string, DemoFlow>),
  ...(import.meta.glob("../examples/would-you-rather.flow.json", { eager: true, import: "default" }) as Record<string, DemoFlow>),
};
const negativeModules = import.meta.glob("../tests/negative/*.json", { eager: true, import: "default" }) as Record<
  string,
  { id: string; input: unknown; issues?: Array<{ path: string }> }
>;

const INLINE_KEY = "imessage-demo-inline";

// Outreach review dashboard (/?view=outreach). Lazy so its code and CSS never load on demo routes.
const OutreachDashboard = lazy(() => import("@/dashboard/OutreachDashboard"));

export function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "outreach") {
    return (
      <Suspense fallback={null}>
        <OutreachDashboard />
      </Suspense>
    );
  }
  const foundation = params.get("foundation");
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  if (foundation === "ios" || foundation === "macos") {
    return <ShellPreview platform={foundation} theme={theme} />;
  }

  const flow = params.get("flow");
  if (flow === "negative") return <NegativeCase id={params.get("case")} />;
  if (flow) return <FlowRoute id={flow} atMs={readTime(params.get("t"))} />;
  return <ManifestRoute />;
}

function FlowRoute({ id, atMs }: { id: string; atMs: number }) {
  // Clean viewer: playback button only. Capture is the manifest route and does not use this path.
  const flow = resolveFlow(id);
  if (!flow) {
    return <ScenarioError issues={[{ path: "/id", message: `UNKNOWN_FLOW: no scenario named ${id}` }]} />;
  }
  const validated = validateDemo(flow);
  if (!validated.ok) return <ScenarioError issues={validated.issues} />;
  const compiled = compileDemo(validated.demo);
  const baseline = validated.demo.startAtMs ?? validated.demo.messages[0]?.atMs ?? 0;
  return (
    <DemoPlayer
      compiled={compiled}
      clean
      initialTimeMs={atMs}
      playbackBaseline={baseline}
      scenarioId={compiled.id}
    />
  );
}

function NegativeCase({ id }: { id: string | null }) {
  const file = Object.values(negativeModules).find((entry) => entry.id === id);
  if (!file) {
    return <ScenarioError issues={[{ path: "/case", message: `UNKNOWN_CASE: ${id ?? ""}` }]} />;
  }
  const validated = validateDemo(file.input);
  const issues = validated.ok
    ? [{ path: "/", message: "INVALID_VALUE: negative case was accepted" }]
    : validated.issues;
  return <ScenarioError issues={issues} />;
}

function ManifestRoute() {
  const [state, setState] = useState<"loading" | "missing" | DemoRunManifest>("loading");
  useEffect(() => {
    let cancelled = false;
    fetch("/__demo/manifest.json")
      .then(async (response) => {
        if (!response.ok) {
          if (!cancelled) setState("missing");
          return;
        }
        const manifest = (await response.json()) as DemoRunManifest;
        if (!cancelled) setState(manifest);
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return null;
  if (state === "missing") return <Home />;
  const requested = new URLSearchParams(window.location.search).get("scenario");
  if (requested && requested !== state.approvedScenarioId && !isCatalogueSceneId(requested)) {
    return <p>Scenario is not approved for this run.</p>;
  }
  return <PlayerHost manifest={state} />;
}

function Home() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: 24 }}>
      <h1>Make any product feel like itself in iMessage.</h1>
      <p>Write a conversation, validate it, then preview or capture the rendered conversation. This page does not send messages.</p>
      <ul>
        <li><a href="/?foundation=ios">Foundation iOS shell</a></li>
        <li><a href="/?foundation=macos">Foundation macOS shell</a></li>
        <li><a href="/?flow=basic-ios-light&t=0">Basic iOS flow</a></li>
        <li><a href="/?flow=basic-macos-dark&t=0">Basic macOS flow</a></li>
      </ul>
    </main>
  );
}

function ScenarioError({ issues }: { issues: ValidationIssue[] }) {
  return (
    <main data-slot="scenario-error" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: 24 }}>
      {issues.map((issue) => (
        <p key={`${issue.path}:${issue.message}`}>
          {dotted(issue.path)} {issue.path} {issue.message}
        </p>
      ))}
    </main>
  );
}

function resolveFlow(id: string): DemoFlow | null {
  const inline = readInline();
  if (inline?.id === id) return inline;
  return Object.values(scenarioModules).find((flow) => flow.id === id) ?? null;
}

function readInline(): DemoFlow | null {
  try {
    const raw = window.sessionStorage.getItem(INLINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoFlow;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readTime(value: string | null): number {
  if (value === null || value === "") return 0;
  const time = Number(value);
  return Number.isFinite(time) ? time : 0;
}

function dotted(path: string): string {
  return path.replace(/^\//, "").replace(/\/(\d+)(?=\/|$)/g, ".$1").replaceAll("/", ".");
}
