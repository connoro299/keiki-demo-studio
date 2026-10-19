import type { CompiledDemo, DemoMessage, IosScreenName, RenderFrame, ScreenEffectName } from "@/contracts";
import { isEmojiOnly } from "@/components/imessage/message-bubble";
import { bubbleEffectDuration, type BubbleEffectKind } from "@/components/imessage/message-effects";
import { messageMotion } from "@/components/imessage/message-motion";
import { typingLoopMs, typingStaggerMs } from "@/components/imessage/typing-indicator";
import { compareTimelineEvents, effectiveSourceIndex, frameAt } from "@/runtime/project";
import type { ScreenTransitionKind } from "@/runtime/types";

export type ArrivalPose = { id: string; progress: number };

export type BubblePose = {
  id: string;
  kind: Exclude<BubbleEffectKind, "invisible-ink">;
  progress: number;
};

export type ScreenEffectPose = {
  effect: ScreenEffectName;
  progress: number;
  messageId?: string;
};

export type ScreenTransitionPose = {
  kind: ScreenTransitionKind;
  progress: number;
  from?: IosScreenName;
  to?: IosScreenName;
};

export type ReactionLanding = {
  messageId: string;
  reactionId: string;
  elapsedMs: number;
  progress: number;
};

export type CueState = {
  send?: ArrivalPose;
  receive?: ArrivalPose;
  bubbleEffect: BubblePose | null;
  typingElapsed: number | null;
  inkElapsed: Array<{ id: string; elapsed: number }>;
  /** Surfaced from `frameAt` screen-effect cues; omitted when settled. */
  screenEffect?: ScreenEffectPose | null;
  /** Surfaced from `frameAt` screen-transition cues; omitted when settled. */
  screenTransition?: ScreenTransitionPose | null;
  /** Active reaction cues. Settled reactions are absent so the badge rests. */
  reactions: ReactionLanding[];
};

function messageEvents(compiled: CompiledDemo, timeMs: number) {
  return compiled.events
    .map((event, index) => ({ event, index }))
    .filter((entry) => entry.event.type === "message" && entry.event.atMs <= timeMs)
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index)
    .map((entry) => entry.event)
    .filter((event): event is Extract<CompiledDemo["events"][number], { type: "message" }> => event.type === "message");
}

/** Text and emoji arrivals are the motions `useArrivalAnimation` can seek. Other kinds have no bubble flight. */
export function supportsArrival(message: DemoMessage): boolean {
  if (message.kind === "link" || message.kind === "image" || message.kind === "audio" || message.kind === "attachment" || message.kind === "app-card") return false;
  return message.kind === undefined || message.kind === "text" || isEmojiOnly(message.text);
}

/**
 * Explicit arrival and effect progress from playback time.
 * At the duration endpoint the cue is omitted so the source handle is canceled and its ghost, clone, and lift are removed.
 */
export function deriveCues(compiled: CompiledDemo, frame: RenderFrame): CueState {
  const visible = new Set(frame.messages.map((message) => message.id));
  const events = messageEvents(compiled, frame.timeMs).filter((event) => visible.has(event.message.id));
  let send: ArrivalPose | undefined;
  let receive: ArrivalPose | undefined;
  const latest = events[events.length - 1];
  if (latest && supportsArrival(latest.message) && !latest.message.effect) {
    const duration = latest.message.direction === "outgoing" ? messageMotion.send.duration : messageMotion.receive.duration;
    const elapsed = frame.timeMs - latest.atMs;
    if (elapsed > 0 && elapsed < duration) {
      const pose = { id: latest.message.id, progress: elapsed / duration };
      if (latest.message.direction === "outgoing") send = pose;
      else receive = pose;
    }
  }

  let bubbleEffect: BubblePose | null = null;
  const inkElapsed: Array<{ id: string; elapsed: number }> = [];
  for (const event of events) {
    const effect = event.message.effect;
    if (!effect) continue;
    const elapsed = frame.timeMs - event.atMs;
    if (elapsed < 0) continue;
    if (effect === "invisible-ink") {
      inkElapsed.push({ id: event.message.id, elapsed });
      continue;
    }
    const duration = bubbleEffectDuration[effect];
    if (duration > 0 && elapsed < duration) {
      bubbleEffect = { id: event.message.id, kind: effect, progress: elapsed / duration };
    }
  }

  let typingElapsed: number | null = null;
  if (frame.typing) {
    const ordered = compiled.events
      .map((event, index) => ({
        event,
        index,
        sourceIndex: effectiveSourceIndex(event, index),
        atMs: event.atMs,
      }))
      .filter((item) => item.event.type === "typing" && Number.isFinite(item.atMs) && item.atMs <= frame.timeMs)
      .sort(compareTimelineEvents);
    let startedAt: number | null = null;
    for (const item of ordered) {
      if (item.event.type !== "typing") continue;
      startedAt = item.event.typing ? (startedAt ?? item.atMs) : null;
    }
    typingElapsed = frame.timeMs - (startedAt ?? 0);
  }

  const visual = frameAt(compiled, frame.timeMs);
  const screenEffectCue = [...visual.cues].reverse().find((cue) => cue.kind === "screen-effect");
  let screenEffect: ScreenEffectPose | null = null;
  if (screenEffectCue?.detail?.effect) {
    const effect = screenEffectCue.detail.effect;
    if (effect === "echo" || effect === "spotlight" || effect === "balloons" || effect === "confetti" || effect === "love" || effect === "lasers" || effect === "fireworks" || effect === "celebration") {
      screenEffect = { effect, progress: screenEffectCue.progress };
      if (screenEffectCue.subjectId !== undefined) screenEffect.messageId = screenEffectCue.subjectId;
    }
  }

  const screenCue = [...visual.cues].reverse().find((cue) => cue.kind === "screen");
  let screenTransition: ScreenTransitionPose | null = null;
  if (screenCue?.transition) {
    screenTransition = { kind: screenCue.transition, progress: screenCue.progress };
    if (screenCue.detail?.fromScreen !== undefined) screenTransition.from = screenCue.detail.fromScreen;
    if (screenCue.detail?.toScreen !== undefined) screenTransition.to = screenCue.detail.toScreen;
  }

  const reactions: ReactionLanding[] = [];
  for (const cue of visual.cues) {
    if (cue.kind !== "reaction" || !cue.subjectId || !cue.detail?.reactionId) continue;
    reactions.push({
      messageId: cue.subjectId,
      reactionId: cue.detail.reactionId,
      elapsedMs: cue.elapsedMs,
      progress: cue.progress,
    });
  }

  return { send, receive, bubbleEffect, typingElapsed, inkElapsed, screenEffect, screenTransition, reactions };
}

export function cueToken(cues: CueState): string {
  return JSON.stringify(cues);
}

/** Freeze the source typing loop at a cue-relative offset. The delay constants are the pin's own. */
export function typingFreezeDelay(index: number, elapsed: number): string {
  return `${index * typingStaggerMs - typingLoopMs - elapsed}ms`;
}

/** Position inside the pin's typing loop for one dot, using the same offset as `typingFreezeDelay`. */
export function typingDotPhaseMs(index: number, elapsed: number): number {
  const phase = (elapsed - index * typingStaggerMs) % typingLoopMs;
  return phase < 0 ? phase + typingLoopMs : phase;
}

/**
 * Pose of one typing dot as a pure function of cue-relative elapsed time, mirroring the
 * `im-typing-dot` keyframes (0/60/100%: rest at .35 opacity; 30%: peak at 1, -1px, 1.06x;
 * ease-in-out between). Seek-driven capture/export runs with `reducedMotion: "reduce"`, whose
 * media rule sets `animation: none`, so pinning the CSS animation's delay alone left every frame
 * on the static fallback; writing the pose inline renders the same frame regardless of motion
 * preference and changes the DOM fingerprint per frame so export dedupe cannot hold a stale pose.
 */
export function typingDotPose(index: number, elapsed: number): { opacity: number; lift: number; scale: number } {
  const p = typingDotPhaseMs(index, elapsed) / typingLoopMs;
  let w = 0;
  if (p < 0.3) w = p / 0.3;
  else if (p < 0.6) w = 1 - (p - 0.3) / 0.3;
  const eased = w * w * (3 - 2 * w);
  return { opacity: 0.35 + 0.65 * eased, lift: eased, scale: 1 + 0.06 * eased };
}

/** Pin a typing dot to its pose at `elapsed`, independent of CSS animation or reduced motion. */
export function pinTypingDot(dot: HTMLElement, index: number, elapsed: number): void {
  const pose = typingDotPose(index, elapsed);
  dot.style.animation = "none";
  dot.style.opacity = pose.opacity.toFixed(3);
  dot.style.transform = `translateY(${(-pose.lift).toFixed(3)}px) scale(${pose.scale.toFixed(4)})`;
}

/** Undo `pinTypingDot` so the running CSS loop drives the dot again (live playback). */
export function unpinTypingDot(dot: HTMLElement): void {
  if (dot.style.animation === "none") dot.style.animation = "";
  dot.style.opacity = "";
  dot.style.transform = "";
}
