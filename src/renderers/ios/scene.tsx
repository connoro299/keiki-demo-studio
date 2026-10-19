import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { storyLabelClock, visibleClock } from "../../runtime/story-clock";
import type { CompiledDemo, RenderFrame, RendererHandle, RendererProps } from "@/contracts";
import { tapbackLandingAt } from "@/contracts/tapback-motion";
import { useBubbleEffectOnMessage } from "@/components/imessage/message-effects";
import { IosMessagesApp, iosScreen, type IosMessagesAppProps } from "@/components/imessage/ios-messages-app";
import { Tapback, type TapbackType } from "@/components/imessage/tapback";
import type { Message } from "@/components/imessage/message-list";
import type { IosConversation } from "@/components/imessage/ios-conversation-list";
import { ScreenEffect } from "@/components/imessage/screen-effects";
import { frameAt } from "@/runtime";
import type { VisualFrame } from "@/runtime";
import { toUpstreamMessage } from "./adapt";
import { statusClock } from "./clock";
import { cueToken, deriveCues, pinTypingDot, typingFreezeDelay, unpinTypingDot, type CueState } from "./cues";
import { effectsPickerShellProps, screenEffectOverlayProps } from "./effects";
import { ImageViewerFromMedia, imageViewerFromFrame } from "./media";
import { screenTransitionShellProps } from "./navigation";
import { frameKey, projectFrame } from "./project";
import { settleIosScene, type IosSettleReceipt } from "./readiness";
import { applyCheckpointScroll, arrivalFollowLift, TYPING_ARRIVAL } from "./scroll";
import { controlledLongPressPose, iosInteractionShell, type InteractionInput } from "./interaction-state";
import { iosInteractionView, undoSendOverlay, type OverlayRenderOptions } from "./overlays";
import { AppCardLayer } from "./app-card/AppCardLayer";
import { PollLayer } from "./poll/PollLayer";
import { renderOwnedContent } from "./owned-content";
import { composerPlaceholder } from "@/renderers/sms-composer";

export type { IosSettleReceipt };

/** WT-06 assembly hook: derive shell + overlay nodes from a projected runtime frame. */
export function iosInteractionFromState(state: InteractionInput, options?: OverlayRenderOptions) {
  return {
    shell: iosInteractionShell(state),
    ...iosInteractionView(state, options),
  };
}


export type IosRendererHandle = RendererHandle & {
  readonly revision: number;
  settle(revision: number): Promise<IosSettleReceipt>;
};

type Session = {
  revision: number;
  key: string;
  override: RenderFrame | null;
  shown: RenderFrame;
  cues: CueState;
};

const emptyCues: CueState = { bubbleEffect: null, typingElapsed: null, inkElapsed: [], reactions: [] };

function conversationsFor(compiled: CompiledDemo, frame: VisualFrame): IosConversation[] {
  const rows = frame.conversations.length > 0 ? frame.conversations : [{
    id: compiled.id,
    contact: frame.contact,
    messages: frame.messages,
    draft: frame.draft,
  }];
  return rows.map((conversation) => {
    const latest = conversation.messages[conversation.messages.length - 1];
    const seed = compiled.conversations?.find((item) => item.id === conversation.id);
    const people = conversation.id === (compiled.selectedConversationId ?? compiled.id) ? compiled.participants : seed?.participants;
    return {
      id: conversation.id,
      name: conversation.contact.name,
      initials: conversation.contact.initials,
      preview: latest?.text || conversation.draft || conversation.contact.name,
      time: statusClock(visibleClock(frame.nowMs, frame.messages)),
      ...(people && people.length > 1 ? { members: people.map((person) => ({ name: person.name, initials: person.initials, src: person.photo })) } : {}),
    };
  });
}

/** The newest message arrival at `timeMs`, and whether it took over from the typing balloon. */
function latestArrival(compiled: CompiledDemo, timeMs: number): { id: string; elapsedMs: number; replacesTyping: boolean } | null {
  let latest: { id: string; atMs: number } | null = null;
  for (const event of compiled.events) {
    if (event.type !== "message" || event.atMs > timeMs) continue;
    if (!latest || event.atMs >= latest.atMs) latest = { id: event.message.id, atMs: event.atMs };
  }
  // The typing balloon appearing grows the log just like a message does.
  for (const event of compiled.events) {
    if (event.type !== "typing" || !event.typing || event.atMs > timeMs) continue;
    if (!latest || event.atMs > latest.atMs) latest = { id: TYPING_ARRIVAL, atMs: event.atMs };
  }
  if (!latest) return null;
  if (latest.id === TYPING_ARRIVAL) return { id: latest.id, elapsedMs: timeMs - latest.atMs, replacesTyping: false };
  const at = latest.atMs;
  const replacesTyping = compiled.events.some((event) => event.type === "typing" && !event.typing && Math.abs(event.atMs - at) < 1 && event.atMs > 0);
  return { id: latest.id, elapsedMs: timeMs - at, replacesTyping };
}

function demoIsPlaying(): boolean {
  return window.IMESSAGE_DEMO?.state().playing === true;
}

function freezeLoops(root: ParentNode, cues: CueState) {
  if (cues.typingElapsed !== null) {
    const elapsed = cues.typingElapsed ?? 0;
    const playing = demoIsPlaying();
    root.querySelectorAll<HTMLElement>('[data-slot="typing-indicator"] > span[data-dot]').forEach((dot) => {
      const index = Number(dot.dataset.dot ?? 0);
      const previous = Number(dot.dataset.typingElapsed);
      const jumped = !Number.isFinite(previous) || elapsed + 32 < previous || elapsed - previous > 80;
      dot.dataset.typingElapsed = String(elapsed);
      if (!playing) {
        pinTypingDot(dot, index, elapsed);
        return;
      }
      unpinTypingDot(dot);
      if (!jumped && dot.style.animationPlayState === "running" && dot.dataset.typingDelay) {
        if (dot.style.animationDelay !== dot.dataset.typingDelay) dot.style.animationDelay = dot.dataset.typingDelay;
        return;
      }
      const delay = typingFreezeDelay(index, elapsed);
      dot.dataset.typingDelay = delay;
      dot.style.animationDelay = delay;
      dot.style.animationPlayState = "running";
    });
  }
  for (const ink of cues.inkElapsed) {
    const row = root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(ink.id)}"]`);
    row?.querySelectorAll<HTMLElement>('[data-slot="invisible-ink"] [data-slot="text"], [data-slot="invisible-ink"] [data-slot="ink-target"]').forEach((node) => {
      node.style.animationDelay = `-${ink.elapsed}ms`;
      node.style.animationPlayState = "paused";
    });
  }
}

export type IosFrameProps = RendererProps & {
  interactive?: boolean;
  onDraft?: (value: string) => void;
  overlay?: ReactNode;
  previewOverlay?: ReactNode;
  shell?: Partial<IosMessagesAppProps>;
};

export const IosFrame = forwardRef<RendererHandle, IosFrameProps>(function IosFrame({ compiled, frame, interactive = false, onDraft, overlay, previewOverlay, shell }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const compiledRef = useRef(compiled);
  compiledRef.current = compiled;
  const session = useRef<Session>({
    revision: 0,
    key: "",
    override: null,
    shown: frame,
    cues: emptyCues,
  });
  const [, setTick] = useState(0);
  const propsKey = frameKey(frame);
  const propsKeyRef = useRef<string | null>(null);
  if (propsKeyRef.current !== propsKey) {
    propsKeyRef.current = propsKey;
    session.current.override = null;
    session.current.key = propsKey;
    session.current.revision += 1;
  }
  const shown = session.current.override ?? frame;
  session.current.shown = shown;
  const visual = useMemo(() => frameAt(compiled, shown.timeMs), [compiled, shown.timeMs]);
  const viewFrame: RenderFrame = {
    timeMs: visual.timeMs,
    platform: visual.platform,
    theme: visual.theme,
    screen: visual.screen,
    contact: visual.contact,
    nowMs: visual.nowMs,
    messages: visual.messages,
    typing: visual.typing,
    draft: visual.draft,
  };
  const cues = useMemo(() => deriveCues(compiled, viewFrame), [compiled, viewFrame]);
  session.current.cues = cues;
  const token = cueToken(cues);
  const committedKey = session.current.key;
  const [poseKey, setPoseKey] = useState<string | null>(null);
  const posed = poseKey === committedKey;
  const bubbleEffect = useMemo(() => (posed ? cues.bubbleEffect : null), [posed, token, cues.bubbleEffect]);
  useBubbleEffectOnMessage(frameRef, bubbleEffect);

  useLayoutEffect(() => {
    const shellNode = frameRef.current;
    if (shellNode) {
      const base = Number.isFinite(visual.scroll) ? Math.max(0, visual.scroll ?? 0) : 0;
      applyCheckpointScroll(shellNode, base + arrivalFollowLift(shellNode, latestArrival(compiled, visual.timeMs)));
      freezeLoops(shellNode, session.current.cues);
    }
    if (poseKey !== committedKey) setPoseKey(committedKey);
  }, [committedKey, poseKey, token, visual.scroll]);

  const handleRef = useRef<IosRendererHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = {
      seek(timeMs: number) {
        const next = projectFrame(compiledRef.current, timeMs);
        session.current.override = next;
        session.current.key = frameKey(next);
        session.current.revision += 1;
        setTick((value) => value + 1);
      },
      get element() {
        return frameRef.current;
      },
      get revision() {
        return session.current.revision;
      },
      settle(revision: number) {
        const host = hostRef.current;
        if (!host) return Promise.reject(new Error("missing node: ios-demo-renderer"));
        return settleIosScene({
          host,
          shell: frameRef.current,
          frame: session.current.shown,
          cues: session.current.cues,
          revision: () => session.current.revision,
          expectedRevision: revision,
        });
      },
    };
  }
  useImperativeHandle(ref, () => handleRef.current as IosRendererHandle, []);

  const view = shellProps(compiled, visual, cues, posed, interactive, onDraft);
  const canonicalOverlay = canonicalOverlayNode(compiled, visual);
  const hostsAppCards = useMemo(() => compiledHasAppCards(compiled), [compiled]);
  const hostsPolls = useMemo(() => compiledHasPolls(compiled), [compiled]);
  const baseOverlay = overlay ?? shell?.overlay ?? canonicalOverlay;
  const castPollVote = (messageId: string, optionId: string) => {
    const message = visual.messages.find((item) => item.id === messageId);
    const poll = message?.poll;
    if (!poll) return;
    const participantId = compiled.participants?.find((person) => person.me)?.id
      ?? poll.voters?.find((voter) => voter.id === "me")?.id
      ?? poll.voters?.[0]?.id
      ?? "me";
    const selected = (poll.votes ?? []).some((vote) => vote.participantId === participantId && vote.optionId === optionId);
    const voted = (poll.selectionMode ?? "multiple") === "single" ? true : !selected;
    window.IMESSAGE_DEMO?.castPollVote?.({ messageId, optionId, participantId, voted });
  };
  return (
    <div
      ref={hostRef}
      data-slot="ios-demo-renderer"
      data-theme={shown.theme}
      data-posed={posed ? "true" : "false"}
      data-time={shown.timeMs}
      data-revision={session.current.revision}
      className={shown.theme === "dark" ? "dark" : undefined}
      style={{ width: iosScreen.width, height: iosScreen.height }}
    >
      <IosMessagesApp
        {...view}
        {...(shell ?? {})}
        messages={shell?.messages ?? view.messages}
        frameRef={frameRef}
        width={iosScreen.width}
        height={iosScreen.height}
        time={view.time}
        now={view.now}
        screen={view.screen}
        screenTransition={shell?.screenTransition ?? view.screenTransition}
        typing={view.typing}
        composer={shell?.composer ?? view.composer}
        sendAnimation={view.sendAnimation}
        receiveAnimation={view.receiveAnimation}
        longPress={shell && "longPress" in shell ? shell.longPress : view.longPress}
        longPressPose={shell?.longPressPose !== undefined ? shell.longPressPose : view.longPressPose}
        renderReactions={shell?.renderReactions ?? view.renderReactions}
        thread={shell && "thread" in shell ? shell.thread : view.thread}
        effectsPicker={shell?.effectsPicker ?? view.effectsPicker}
        audioControl={shell?.audioControl ?? view.audioControl}
        timeReveal={shell?.timeReveal ?? view.timeReveal}
        overlay={
          <>
            {baseOverlay}
            {hostsAppCards ? <AppCardLayer messages={visual.messages} frameRef={frameRef}
              playing={demoIsPlaying()} finished={visual.timeMs >= compiled.durationMs} timeMs={visual.timeMs}
              sheetEvents={compiled.events.filter(event => event.type === "sheet-app")}
              finalMessageId={compiled.events.filter(event => event.type === "message").sort((a, b) => a.atMs - b.atMs).at(-1)?.message.id} /> : null}
            {hostsPolls ? (
              <PollLayer compiled={compiled} frame={visual} frameRef={frameRef} onVote={castPollVote} />
            ) : null}
            {previewOverlay}
          </>
        }
        style={shell?.style}
      />
    </div>
  );
});

function shellProps(
  compiled: CompiledDemo,
  frame: VisualFrame,
  cues: CueState,
  posed: boolean,
  interactive: boolean,
  onDraft?: (value: string) => void,
): IosMessagesAppProps {
  const interaction = iosInteractionShell(frame);
  const longPressPose = controlledLongPressPose(compiled, frame);
  const transition = screenTransitionShellProps(frame);
  return {
    width: iosScreen.width,
    height: iosScreen.height,
    time: statusClock(visibleClock(frame.nowMs, frame.messages)),
    screen: frame.screen,
    screenTransition: transition ?? { from: frame.screen, progress: 1 },
    conversations: conversationsFor(compiled, frame),
    contact: frame.contact,
    group: Boolean(compiled.group) || (compiled.participants?.length ?? 0) > 1,
    participants: compiled.participants?.map((person) => ({ name: person.name, initials: person.initials, src: person.photo })),
    messages: frame.messages.map(toUpstreamMessage),
    typing: frame.typing,
    now: Math.max(frame.nowMs, storyLabelClock(compiled)),
    composer: {
      value: frame.draft,
      placeholder: composerPlaceholder(compiled.channel),
      onChange: interactive && onDraft ? onDraft : () => {},
    },
    sendAnimation: posed && cues.send ? cues.send : null,
    receiveAnimation: posed && cues.receive ? cues.receive : null,
    longPress: interaction.longPress,
    longPressPose,
    renderReactions: scriptedReactions(frame, cues),
    thread: interaction.thread,
    effectsPicker: effectsPickerShellProps(frame),
    audioControl: frame.audio,
    timeReveal: frame.timeReveal,
    renderContent: (message, content) => renderOwnedContent(compiled, frame, message, content),
    ...controlledSurfaces(frame),
    photos: compiled.library?.map((photo) => ({ id: photo.id, src: photo.src, alt: photo.alt })),
  };
}

function overlayProgress(frame: VisualFrame): number | undefined {
  const enter = [...frame.cues].reverse().find((cue) => cue.kind === "overlay-enter");
  if (enter && frame.overlay.kind !== "closed") return enter.progress;
  return frame.overlay.kind === "closed" ? undefined : 1;
}

function controlledSurfaces(frame: VisualFrame): Partial<IosMessagesAppProps> {
  const overlay = frame.overlay;
  const progress = overlayProgress(frame);
  return {
    plusMenu: overlay.kind === "plus-menu" ? { progress } : null,
    photoPicker: overlay.kind === "photo-picker"
      ? { selected: overlay.selectedIds ?? (overlay.selectedId ? [overlay.selectedId] : []), detent: overlay.detent, progress }
      : null,
    stickerPicker: overlay.kind === "sticker-picker" ? { tab: overlay.tab, progress } : null,
    audioRecorder: overlay.kind === "recorder"
      ? { state: overlay.state, position: overlay.position, duration: overlay.duration, progress }
      : null,
    details: overlay.kind === "details" ? { progress } : null,
    tapbackDetails: overlay.kind === "tapback-details" ? { id: overlay.messageId, progress, filter: overlay.filter } : null,
    search: overlay.kind === "search" ? { query: overlay.query, progress } : null,
    photoViewer: overlay.kind === "image-viewer"
      ? { id: overlay.messageId, index: overlay.index, progress, chrome: overlay.chrome, dismiss: overlay.dismiss }
      : null,
    selectMode: overlay.kind === "selection" ? { progress } : null,
    selectedMessageIds: overlay.kind === "selection" ? overlay.messageIds : [],
  };
}

/** Only a flow that authors a live app card mounts the card layer and its Apple Pay presentation. */
function compiledHasPolls(compiled: CompiledDemo): boolean {
  return (
    compiled.events.some((event) => event.type === "message" && event.message.kind === "poll") ||
    Boolean(compiled.initialState?.conversations?.some((conversation) => conversation.messages?.some((message) => message.kind === "poll")))
  );
}

function compiledHasAppCards(compiled: CompiledDemo): boolean {
  return (
    compiled.events.some((event) => event.type === "message" && event.message.kind === "app-card") ||
    Boolean(compiled.initialState?.conversations?.some((conversation) => conversation.messages?.some((message) => message.kind === "app-card")))
  );
}

function scriptedReactions(frame: VisualFrame, cues: CueState): NonNullable<IosMessagesAppProps["renderReactions"]> {
  return (message: Message) => {
    const logical = frame.messages.find((item) => item.id === message.id);
    const reactions = logical?.reactions ?? [];
    if (reactions.length === 0) return undefined;
    const outgoing = message.direction === "outgoing";
    return (
      <div data-slot="reaction-stack" style={{ display: "flex", gap: 2 }}>
        {reactions.map((reaction) => {
          const landing = cues.reactions.find((item) => item.messageId === message.id && item.reactionId === reaction.id);
          const pose = landing ? tapbackLandingAt(landing.elapsedMs) : null;
          const classic = reaction.emoji ? undefined : (reaction.type as TapbackType);
          return (
            <Tapback
              key={reaction.id}
              reaction={classic}
              emoji={reaction.emoji}
              own={reaction.byMe ?? true}
              side={outgoing ? "left" : "right"}
              animateIn={false}
              style={pose ? { opacity: pose.opacity, transform: `scale(${pose.scale})` } : undefined}
            />
          );
        })}
      </div>
    );
  };
}

function canonicalOverlayNode(compiled: CompiledDemo, frame: VisualFrame): ReactNode {
  const interaction = iosInteractionView(frame, { contact: frame.contact, selectionInList: true });
  const viewer = imageViewerFromFrame(frame);
  const effect = screenEffectOverlayProps(frame);
  return (
    <>
      {interaction.notices}
      {interaction.overlays}
      {viewer.photos.length > 0 && (viewer.open || viewer.progress > 0) ? <ImageViewerFromMedia viewer={viewer} /> : null}
      {effect ? <ScreenEffect kind={effect.kind} progress={effect.progress} /> : null}
      {undoSendOverlay(compiled, frame.timeMs)}
    </>
  );
}

export const IosDemoRenderer = forwardRef<RendererHandle, RendererProps>(function IosDemoRenderer(props, ref) {
  return <IosFrame {...props} ref={ref} />;
});

export function IosInspectSession({ compiled, frame }: RendererProps) {
  const [draft, setDraft] = useState(frame.draft);
  const [mark, setMark] = useState(0);
  const [generation, setGeneration] = useState(0);
  const shown = { ...frame, draft };
  return (
    <div data-slot="ios-inspect">
      <div data-slot="inspect-labels">
        <span>Inspect</span>
        <button type="button" onClick={() => setMark((value) => value + 1)}>Mark</button>
        <span data-slot="inspect-mark">{mark}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(frame.draft);
            setMark(0);
            setGeneration((value) => value + 1);
          }}
        >
          Reset
        </button>
      </div>
      <IosFrame key={generation} compiled={compiled} frame={shown} interactive onDraft={setDraft} />
    </div>
  );
}

export function bindIosHandle(ref: Ref<RendererHandle> | null | undefined): IosRendererHandle | null {
  if (!ref || typeof ref === "function") return null;
  const current = ref.current;
  if (!current || !("settle" in current)) return null;
  return current as IosRendererHandle;
}
