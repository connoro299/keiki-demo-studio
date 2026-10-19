import type { CompiledDemo, DemoMessage, RenderFrame } from "@/contracts";
import { formatClockTime } from "@/components/imessage/date-separator";
import { messageMotion } from "@/components/imessage/message-motion";
import type { Message } from "@/components/imessage/message-list";
import type { SidebarConversation } from "@/components/imessage/macos-sidebar";
import { macTransitions } from "@/components/imessage/macos-messages-app";
import type { MacArrival, MacConversationInput, MacMessageExtras, MacSceneInput } from "@/renderers/macos/types";

type CarriedMessage = DemoMessage & MacMessageExtras;

export function mapDemoMessage(message: DemoMessage): Message {
  const extra = message as CarriedMessage;
  const link = extra.link;
  return {
    id: message.id,
    text: message.text,
    direction: message.direction,
    sentAt: message.sentAt ?? message.atMs,
    // Validation keeps app cards off macOS; the pinned MessageKind has no such row.
    kind:
      message.kind === "text" ||
      message.kind === "link" ||
      message.kind === "attachment" ||
      message.kind === "image" ||
      message.kind === "audio" ||
      message.kind === "system"
        ? message.kind
        : undefined,
    service: message.service,
    status: message.status,
    effect: message.effect,
    sender: extra.sender,
    senderInitials: extra.senderInitials,
    edited: extra.edited,
    readAt: extra.readAtMs,
    reactions: extra.reactions,
    replyTo: extra.replyTo,
    replyCount: extra.replyCount,
    link: link ? { url: link.url, title: link.title, host: link.host, image: link.image } : undefined,
    attachments: extra.attachments ?? message.attachments,
    images: message.images,
    audio: message.audio,
  };
}

/** Sidebar copy derived from the authored message. The transcript string is not rewritten. */
export function previewFromMessage(message: DemoMessage): string {
  switch (message.kind) {
    case "link":
      return message.link?.title || message.link?.host || message.link?.url || message.text;
    case "attachment":
      return message.attachments?.[0]?.name || message.text;
    case "image":
      return message.images?.[0]?.alt || message.text;
    case "audio":
      return message.text || "Audio Message";
    default:
      return message.text;
  }
}

export function macConversationId(name: string, explicit?: string): string {
  if (explicit) return explicit;
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "conversation";
}

export function initialsFor(name: string, explicit?: string): string {
  if (explicit) return explicit;
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export type ResolvedConversation = {
  id: string;
  contact: { name: string; initials?: string; photo?: string };
  messages: DemoMessage[];
  draft: string;
  typing: boolean;
  group: boolean;
  pinned?: boolean;
  muted?: boolean;
  unread?: boolean | number;
  preview?: string;
  time?: string;
};

export type ResolvedMacScene = {
  conversations: ResolvedConversation[];
  selected: ResolvedConversation;
  switchFrom: ResolvedConversation | null;
  conversationProgress: number | undefined;
  active: boolean;
  contextMenu: { id: string; x: number; y: number } | null;
  plusMenu: boolean;
  menuProgress: number | undefined;
  selectedMessageIds: readonly string[] | undefined;
  arrival: MacSceneInput["arrival"];
  bubbleEffect: MacSceneInput["bubbleEffect"];
  screenEffect: MacSceneInput["screenEffect"];
  thread: MacSceneInput["thread"];
  footer: string | undefined;
  inspect: MacSceneInput["inspect"];
  checkpoint: string;
  /** True while a seeked arrival is still in flight (helpers are owned, not stale). */
  arrivalInFlight: boolean;
  switchInFlight: boolean;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function resolveMacScene(frame: RenderFrame, scene: MacSceneInput | undefined, soughtMs: number | null): ResolvedMacScene {
  const timeMs = soughtMs ?? frame.timeMs;
  const timeline = scene?.timeline;
  const frameId = scene?.selectedId ?? macConversationId(frame.contact.name);
  let selectedId = frameId;
  let switchFromId = scene?.switchFromId;
  let conversationProgress = scene?.conversationProgress;

  if (soughtMs !== null && timeline?.conversation) {
    const span = timeline.conversation;
    const endMs = span.startMs + span.durationMs;
    if (timeMs < span.startMs) {
      selectedId = span.fromId;
      switchFromId = undefined;
      conversationProgress = undefined;
    } else if (timeMs > endMs) {
      selectedId = span.toId;
      switchFromId = undefined;
      conversationProgress = undefined;
    } else {
      selectedId = span.toId;
      switchFromId = span.fromId;
      conversationProgress = clamp01((timeMs - span.startMs) / span.durationMs);
    }
  }

  const frameConversation: ResolvedConversation = {
    id: frameId,
    contact: { name: frame.contact.name, initials: initialsFor(frame.contact.name, frame.contact.initials) },
    messages: frame.messages.filter((message) => (message.kind as string | undefined) !== "typing"),
    draft: frame.draft,
    typing: frame.typing,
    group: scene?.group ?? frame.messages.some((message) => Boolean((message as CarriedMessage).sender)),
  };

  const extras = new Map<string, ResolvedConversation>();
  for (const input of scene?.conversations ?? []) {
    extras.set(input.id, conversationFromInput(input, input.id === frameConversation.id ? frameConversation : null));
  }
  if (!extras.has(frameConversation.id)) extras.set(frameConversation.id, frameConversation);
  else {
    const prior = extras.get(frameConversation.id)!;
    extras.set(frameConversation.id, {
      ...prior,
      ...frameConversation,
      pinned: prior.pinned,
      muted: prior.muted,
      unread: prior.unread,
      preview: prior.preview,
      time: prior.time,
      group: frameConversation.group || prior.group,
    });
  }

  const selected = extras.get(selectedId) ?? frameConversation;
  const switchFrom = switchFromId ? extras.get(switchFromId) ?? null : null;
  let arrival = scene?.arrival ?? null;
  if (soughtMs !== null && timeline?.arrival) {
    const span = timeline.arrival;
    const endMs = span.startMs + span.durationMs;
    if (timeMs < span.startMs || timeMs > endMs) arrival = null;
    else arrival = { id: span.id, kind: span.kind, progress: clamp01((timeMs - span.startMs) / span.durationMs) };
  }

  const arrivalInFlight = Boolean(arrival && (arrival.progress === undefined || arrival.progress < 1));
  const switchInFlight = Boolean(switchFrom);

  const checkpoint = JSON.stringify({
    from: switchFrom?.id ?? null,
    to: selected.id,
    progress: conversationProgress ?? null,
    menu: scene?.contextMenu ?? null,
    plus: scene?.plusMenu ?? false,
    menuProgress: scene?.menuProgress ?? null,
    arrival: arrival ?? null,
    messages: selected.messages.map((message) => message.id),
    fromMessages: switchFrom?.messages.map((message) => message.id) ?? [],
  });

  return {
    conversations: [...extras.values()],
    selected,
    switchFrom,
    conversationProgress,
    active: scene?.active ?? true,
    contextMenu: scene?.contextMenu ?? null,
    plusMenu: scene?.plusMenu ?? false,
    menuProgress: scene?.menuProgress,
    selectedMessageIds: scene?.selectedMessageIds,
    arrival,
    bubbleEffect: scene?.bubbleEffect ?? null,
    screenEffect: scene?.screenEffect ?? null,
    thread: scene?.thread ?? null,
    footer: scene?.footer,
    inspect: scene?.inspect ?? null,
    checkpoint,
    arrivalInFlight,
    switchInFlight,
  };
}

function conversationFromInput(input: MacConversationInput, frameOverride: ResolvedConversation | null): ResolvedConversation {
  const messages = frameOverride?.messages ?? input.messages ?? [];
  return {
    id: input.id,
    contact: {
      name: frameOverride?.contact.name ?? input.contact.name,
      initials: initialsFor(frameOverride?.contact.name ?? input.contact.name, frameOverride?.contact.initials ?? input.contact.initials),
      photo: input.contact.photo,
    },
    messages,
    draft: frameOverride?.draft ?? input.draft ?? "",
    typing: frameOverride?.typing ?? input.typing ?? false,
    group: frameOverride?.group ?? input.group ?? messages.some((message) => Boolean((message as CarriedMessage).sender)),
    pinned: input.pinned,
    muted: input.muted,
    unread: input.unread,
    preview: input.preview,
    time: input.time,
  };
}

export function toSidebarConversation(conversation: ResolvedConversation, nowMs: number): SidebarConversation {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    name: conversation.contact.name,
    initials: initialsFor(conversation.contact.name, conversation.contact.initials),
    preview: conversation.preview ?? (last ? previewFromMessage(last) : ""),
    time: conversation.time ?? (last ? formatClockTime(last.atMs) : formatClockTime(nowMs)),
    pinned: conversation.pinned,
    muted: conversation.muted,
    unread: conversation.unread,
    photo: conversation.contact.photo,
  };
}

export function playbackArrival(compiled: CompiledDemo, frame: RenderFrame): MacArrival | null {
  let latest: { atMs: number; message: CompiledDemo["events"][number] & { type: "message" } } | null = null;
  for (const event of compiled.events) {
    if (event.type !== "message" || event.atMs > frame.timeMs) continue;
    if (!latest || event.atMs >= latest.atMs) latest = { atMs: event.atMs, message: event };
  }
  if (!latest) return null;
  const message = latest.message.message;
  if (message.effect || (message.kind && message.kind !== "text")) return null;
  const duration = message.direction === "outgoing" ? messageMotion.send.duration : messageMotion.receive.duration;
  const elapsed = frame.timeMs - latest.atMs;
  if (elapsed <= 0 || elapsed >= duration) return null;
  return {
    id: message.id,
    kind: message.direction === "outgoing" ? "send" : "receive",
    progress: elapsed / duration,
  };
}

export function arrivalFor(message: Message | undefined, arrival: MacSceneInput["arrival"]): { send: { id: string; progress?: number } | null; receive: { id: string; progress?: number } | null } {
  if (!arrival || !message || message.id !== arrival.id) return { send: null, receive: null };
  // The shell's arrival query hits the reply stub's bubble first. Skip that flight.
  if (message.replyTo) return { send: null, receive: null };
  // Progress 1 is the settled bubble. Leaving the handle mounted keeps a hidden clone.
  if (arrival.progress !== undefined && arrival.progress >= 1) return { send: null, receive: null };
  const value = { id: arrival.id, progress: arrival.progress };
  if (arrival.kind === "send") return { send: value, receive: null };
  return { send: null, receive: value };
}

export const macMotionDurations = {
  conversation: macTransitions.conversation.duration,
  send: messageMotion.send.duration,
  receive: messageMotion.receive.duration,
} as const;
