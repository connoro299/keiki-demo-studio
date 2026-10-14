import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompiledDemo, DemoChannel, DemoPlayerProps, DemoPlatform, DemoTheme, RendererHandle } from "@/contracts";
import { applyChannel } from "@/compiler";
import profiles from "@/contracts/render-profiles.json";
import { createPlayer } from "@/runtime";
import { IosFrame } from "@/renderers/ios";
import { useInteractivePreview } from "./interactive-preview";
import { MacDemoRenderer, type MacRendererHandle } from "@/renderers/macos";
import { ChatDemoRenderer, isChatChannel, type ChatRendererHandle } from "@/renderers/chat";
import { CatalogueRoute, CatalogueSceneById, isCatalogueSceneId } from "@/player/catalogue";
import { createRuntimeSession } from "@/player/controller";
import { playbackBarHeightPx, playbackControlLabel, runPlaybackControl } from "@/player/playback";
import type { DemoRunManifest, NamedCheckpoint } from "@/player/types";

export type DemoPlayerViewProps = DemoPlayerProps & {
  /** Minimal viewer: playback button only, no scenario/platform/theme toolbar. */
  clean?: boolean;
  /** Automated capture: no visible controls and no automatic playback. */
  capture?: boolean;
  checkpoints?: NamedCheckpoint[];
  scenarioId?: string;
  onScenario?: (id: string) => void;
  scenarios?: { id: string; title: string }[];
  initialTimeMs?: number;
  playbackBaseline?: number;
};

const noCheckpoints: NamedCheckpoint[] = [];

export function DemoPlayer({
  compiled,
  ref,
  clean = false,
  capture = false,
  checkpoints = noCheckpoints,
  scenarioId,
  onScenario,
  scenarios,
  initialTimeMs = 0,
  playbackBaseline = 0,
}: DemoPlayerViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<RendererHandle>(null);
  const bindMacRenderer = useCallback((handle: MacRendererHandle | null) => {
    rendererRef.current = handle;
  }, []);
  const bindChatRenderer = useCallback((handle: ChatRendererHandle | null) => {
    rendererRef.current = handle;
  }, []);
  const [platform, setPlatform] = useState<DemoPlatform>(compiled.platform);
  const [channel, setChannel] = useState<DemoChannel>(() => channelOverride() ?? compiled.channel ?? "imessage");
  const [theme, setTheme] = useState<DemoTheme>(compiled.theme);
  const [tick, setTick] = useState(0);
  const [preview, setPreview] = useState<{ source: CompiledDemo; compiled: CompiledDemo; timeMs: number } | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [seekKey, setSeekKey] = useState(0);
  const [resetToOpening, setResetToOpening] = useState(false);
  const activePreview = preview?.source === compiled ? preview : null;
  const sourceCompiled = activePreview?.compiled ?? compiled;
  const activeCompiled = useMemo(() => applyChannel(sourceCompiled, channel), [sourceCompiled, channel]);
  // WhatsApp, Telegram and Slack are iPhone-sized renderers regardless of the Messages platform toggle.
  const chat = isChatChannel(channel);
  const viewPlatform: DemoPlatform = chat ? "ios" : platform;
  const player = useMemo(() => {
    const created = createPlayer(activeCompiled);
    const start = activePreview?.timeMs ?? (replayKey || resetToOpening ? 0 : initialTimeMs);
    if (start !== 0) created.seek(start);
    return created;
  }, [activeCompiled, activePreview, initialTimeMs, replayKey, resetToOpening]);
  const session = useMemo(
    () =>
      createRuntimeSession({
        compiled: activeCompiled,
        player,
        checkpoints,
        getRenderer: () => rendererRef.current,
        getFrameElement: () => frameRef.current,
      }),
    [activeCompiled, player, checkpoints],
  );
  const lastReplay = useRef(replayKey);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const exposedSession = useMemo(() => ({
    ...session,
    async seek(timeMs: number) {
      setSeekKey(key => key + 1);
      return session.seek(timeMs);
    },
    async reset() {
      setSeekKey(key => key + 1);
      session.pause();
      if (!activePreview) return session.reset();
      setPreview(null); setPreviewDirty(false); setResetToOpening(true);
      // Wait for the source timeline's session before issuing a receipt for its opening frame.
      while (sessionRef.current === session) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return sessionRef.current.reset();
    },
  }), [session, activePreview]);
  useEffect(() => {
    if (lastReplay.current === replayKey) return;
    lastReplay.current = replayKey;
    player.play();
  }, [player, replayKey]);

  useEffect(() => {
    session.setView(viewPlatform, theme);
  }, [viewPlatform, session, theme]);

  useEffect(() => {
    const handle: RendererHandle = {
      seek(timeMs: number) {
        void session.seek(timeMs);
      },
      get element() {
        return rendererRef.current?.element ?? frameRef.current;
      },
    };
    if (typeof ref === "function") ref(handle);
    else if (ref) ref.current = handle;
    return () => {
      if (typeof ref === "function") ref(null);
      else if (ref) ref.current = null;
    };
  }, [ref, session]);

  if (typeof window !== "undefined") {
    window.IMESSAGE_DEMO = exposedSession;
    window.__demoPlayer = exposedSession;
  }

  useEffect(() => {
    window.IMESSAGE_DEMO = exposedSession;
    window.__demoPlayer = exposedSession;
    return () => {
      if (window.IMESSAGE_DEMO === exposedSession) delete window.IMESSAGE_DEMO;
      if (window.__demoPlayer === exposedSession) delete window.__demoPlayer;
    };
  }, [exposedSession]);

  useEffect(() => player.subscribe(() => setTick((value) => value + 1)), [player]);

  useEffect(() => {
    let frameId = 0;
    const loop = () => {
      if (player.state().playing) setTick((value) => value + 1);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [player]);

  useEffect(() => {
    const active = player;
    return () => {
      active.pause();
    };
  }, [player]);

  const state = player.state();
  const frame = { ...session.frame(), platform: viewPlatform, theme };
  const profile = profiles[viewPlatform];
  const compiledView = { ...session.playbackCompiled(), platform: viewPlatform, theme };
  const playbackLabel = playbackControlLabel(state);
  const replayDemo = () => {
    player.pause(); setPreview(null); setPreviewDirty(false); setReplayKey(key => key + 1);
  };
  const interaction = useInteractivePreview({
    frame, playing: state.playing, enabled: !capture && viewPlatform === "ios" && !chat, resetKey: replayKey + seekKey,
    pause: () => player.pause(), changed: () => setPreviewDirty(true),
    append(events, settleMs = 0) {
      player.pause();
      const sourceIndex = Math.max(0, ...activeCompiled.events.map(event => event.sourceIndex ?? 0)) + 1;
      const timeMs = player.state().timeMs + settleMs;
      setPreview({ source: compiled, timeMs, compiled: {
        ...activeCompiled,
        durationMs: Math.max(activeCompiled.durationMs, timeMs),
        events: [...activeCompiled.events, ...events.map((event, index) => ({ ...event, sourceIndex: sourceIndex + index }))],
      } });
    },
  });
  const onPlayback = () => {
    if (playbackLabel === "Replay" && previewDirty) { replayDemo(); return; }
    void runPlaybackControl(player.state(), session);
  };

  return (
    <div
      data-demo-player=""
      data-clean={clean ? "true" : "false"}
      data-capture={capture ? "true" : "false"}
      data-tick={tick}
    >
      {capture ? null : clean ? (
        <div
          data-playback-bar=""
          style={{
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            width: profile.width,
            height: playbackBarHeightPx,
            padding: "0 12px",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          <PlaybackButton label={playbackLabel} onClick={onPlayback} />
        </div>
      ) : (
        <PlayerChrome
          platform={platform}
          channel={channel}
          theme={theme}
          playbackLabel={playbackLabel}
          inspect={session.inspect().messageId}
          scenarioId={scenarioId ?? compiled.id}
          scenarios={scenarios ?? [{ id: compiled.id, title: compiled.id }]}
          onScenario={onScenario}
          onPlatform={setPlatform}
          onChannel={setChannel}
          onTheme={setTheme}
          onPlayback={onPlayback}
        />
      )}
      {!capture && previewDirty && <div style={{ width: profile.width, padding: "4px 12px", boxSizing: "border-box" }}>
        <button type="button" onClick={replayDemo}>Replay demo</button>
        <span style={{ marginLeft: 8, fontSize: 12 }}>Local changes only</span>
      </div>}
      <div
        ref={frameRef}
        data-demo-frame=""
        data-platform={viewPlatform}
        data-channel={channel}
        data-theme={theme}
        data-playback-baseline={playbackBaseline}
        className={theme === "dark" ? "dark" : undefined}
        style={{ width: profile.width, height: profile.height }}
      >
        {chat ? (
          <ChatDemoRenderer ref={bindChatRenderer} compiled={compiledView} frame={frame} channel={channel} />
        ) : viewPlatform === "macos" ? (
          <MacDemoRenderer ref={bindMacRenderer} compiled={compiledView} frame={frame} />
        ) : (
          <IosFrame ref={rendererRef} compiled={compiledView} frame={frame} shell={interaction.shell} previewOverlay={interaction.overlay} />
        )}
      </div>
    </div>
  );
}

function PlaybackButton({ label, onClick }: { label: ReturnType<typeof playbackControlLabel>; onClick: () => void }) {
  return (
    <button type="button" data-playback-control="" onClick={onClick}>
      {label}
    </button>
  );
}

const CHANNEL_OPTIONS: Array<{ id: DemoChannel; label: string }> = [
  { id: "imessage", label: "iMessage" },
  { id: "sms", label: "SMS" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "slack", label: "Slack" },
];

/** `?channel=whatsapp` views any scenario in another channel. */
function channelOverride(): DemoChannel | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("channel");
  return CHANNEL_OPTIONS.some((option) => option.id === value) ? (value as DemoChannel) : null;
}

function PlayerChrome(props: {
  platform: DemoPlatform;
  channel: DemoChannel;
  theme: DemoTheme;
  playbackLabel: ReturnType<typeof playbackControlLabel>;
  inspect: string | null;
  scenarioId: string;
  scenarios: { id: string; title: string }[];
  onScenario?: (id: string) => void;
  onPlatform: (platform: DemoPlatform) => void;
  onChannel: (channel: DemoChannel) => void;
  onTheme: (theme: DemoTheme) => void;
  onPlayback: () => void;
}) {
  return (
    <div data-player-chrome="">
      <label>
        Scenario
        <select aria-label="Scenario" value={props.scenarioId} onChange={(event) => props.onScenario?.(event.target.value)}>
          {props.scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.title}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="button" aria-pressed={props.platform === "ios"} onClick={() => props.onPlatform("ios")}>
          iOS
        </button>
        <button type="button" aria-pressed={props.platform === "macos"} onClick={() => props.onPlatform("macos")}>
          macOS
        </button>
      </div>
      <div data-channel-switcher="">
        {CHANNEL_OPTIONS.map((option) => (
          <button key={option.id} type="button" aria-pressed={props.channel === option.id} onClick={() => props.onChannel(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      <div>
        <button type="button" aria-pressed={props.theme === "light"} onClick={() => props.onTheme("light")}>
          Light
        </button>
        <button type="button" aria-pressed={props.theme === "dark"} onClick={() => props.onTheme("dark")}>
          Dark
        </button>
      </div>
      <PlaybackButton label={props.playbackLabel} onClick={props.onPlayback} />
      {props.inspect ? <p data-inspect-id={props.inspect}>Inspect {props.inspect}</p> : null}
    </div>
  );
}

export function PlayerHost({ manifest }: { manifest: DemoRunManifest }) {
  const [scenarioId, setScenarioId] = useState(manifest.approvedScenarioId);
  const capture = manifest.mode === "capture";
  const clean = manifest.clean || capture;
  const catalogue = isCatalogueSceneId(scenarioId) || manifest.mode === "catalogue";

  if (catalogue) {
    return (
      <div data-demo-player="" data-clean={clean ? "true" : "false"} data-capture={capture ? "true" : "false"}>
        {clean ? null : (
          <div data-player-chrome="">
            <p>Catalogue</p>
          </div>
        )}
        <div data-demo-frame="" data-theme={manifest.theme} className={manifest.theme === "dark" ? "dark" : undefined}>
          {manifest.mode === "catalogue" && scenarioId === manifest.approvedScenarioId ? (
            <CatalogueRoute theme={manifest.theme} />
          ) : (
            <CatalogueSceneById id={scenarioId} theme={manifest.theme} />
          )}
        </div>
      </div>
    );
  }

  if (!manifest.compiled) {
    return <p data-player-error="">No compiled scenario is approved for this run.</p>;
  }

  if (scenarioId !== manifest.approvedScenarioId && !isCatalogueSceneId(scenarioId)) {
    return <p data-player-error="">Scenario is not approved for this run.</p>;
  }

  return (
    <DemoPlayer
      compiled={manifest.compiled}
      clean={clean}
      capture={capture}
      checkpoints={manifest.checkpoints}
      scenarioId={scenarioId}
      onScenario={setScenarioId}
      scenarios={[
        { id: manifest.approvedScenarioId, title: manifest.compiled.id },
        { id: "ios-text", title: "iOS text conversation" },
        { id: "macos-text", title: "macOS text conversation" },
      ]}
    />
  );
}
