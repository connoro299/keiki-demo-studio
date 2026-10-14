import type { CompiledDemo, DemoChannel, DemoMessage, DemoParticipant, MessageStatus, RenderFrame } from "@/contracts";

/**
 * Shared, pure model for the repository-owned chat renderers (WhatsApp, Telegram, Slack).
 *
 * Everything here is a function of the compiled timeline and the frame's playback time. No timers,
 * no free-running animation: arrival motion, typing dots, caret blink and receipt colour changes are
 * all derived from `frame.timeMs` against the time the relevant event entered the timeline, so a
 * `seek(t)` always produces the same picture.
 */

export type ChatChannel = Extract<DemoChannel, "whatsapp" | "telegram" | "slack">;

export const CHAT_CHANNELS: readonly ChatChannel[] = ["whatsapp", "telegram", "slack"];

export function isChatChannel(channel: string | null | undefined): channel is ChatChannel {
  return channel === "whatsapp" || channel === "telegram" || channel === "slack";
}

/** Motion constants (ms). Arrival is a height grow plus a short fade/rise, like the native lists. */
export const chatMotion = {
  arrival: 340,
  reaction: 360,
  receipt: 240,
  typingEnter: 220,
  caretBlink: 530,
  caretHold: 600,
} as const;

export type ChatTimeline = {
  /** Playback time a message entered the thread. Messages present at 0 are settled. */
  arrivals: Map<string, number>;
  /** Playback time a reaction id was committed. */
  reactions: Map<string, number>;
  /** Status events per message, sorted. */
  statuses: Map<string, Array<{ atMs: number; status: MessageStatus }>>;
  /** Times typing switched on (sorted). */
  typingOn: number[];
  /** Times the composer draft changed (sorted). */
  draftChanges: number[];
  /** Incoming message arrival times (sorted), used to derive implicit read receipts. */
  incoming: number[];
};

const timelineCache = new WeakMap<CompiledDemo, ChatTimeline>();

export function buildTimeline(compiled: CompiledDemo): ChatTimeline {
  const cached = timelineCache.get(compiled);
  if (cached) return cached;
  const arrivals = new Map<string, number>();
  const reactions = new Map<string, number>();
  const statuses = new Map<string, Array<{ atMs: number; status: MessageStatus }>>();
  const typingOn: number[] = [];
  const draftChanges: number[] = [];
  const incoming: number[] = [];
  let previousTyping = false;
  const ordered = [...compiled.events].map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.atMs - b.event.atMs || (a.event.sourceIndex ?? a.index) - (b.event.sourceIndex ?? b.index) || a.index - b.index);
  let previousDraft = "";
  for (const { event } of ordered) {
    switch (event.type) {
      case "message": {
        if (!arrivals.has(event.message.id)) arrivals.set(event.message.id, event.atMs);
        if (event.message.direction === "incoming") incoming.push(event.atMs);
        break;
      }
      case "reaction":
        if (event.reaction && !reactions.has(event.reactionId)) reactions.set(event.reactionId, event.atMs);
        break;
      case "status": {
        const list = statuses.get(event.messageId) ?? [];
        list.push({ atMs: event.atMs, status: event.status });
        statuses.set(event.messageId, list);
        break;
      }
      case "typing":
        if (event.typing && !previousTyping) typingOn.push(event.atMs);
        previousTyping = event.typing;
        break;
      case "draft":
        if (event.value !== previousDraft) draftChanges.push(event.atMs);
        previousDraft = event.value;
        break;
      default:
        break;
    }
  }
  const timeline = { arrivals, reactions, statuses, typingOn, draftChanges, incoming };
  timelineCache.set(compiled, timeline);
  return timeline;
}

export const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);
export const easeOutCubic = (value: number) => 1 - (1 - clamp01(value)) ** 3;
/** Ease-out with a small overshoot, for pops (reactions, bubble scale). */
export function easeOutBack(value: number, overshoot = 1.4): number {
  const x = clamp01(value) - 1;
  return 1 + (overshoot + 1) * x ** 3 + overshoot * x ** 2;
}

/** 0..1 progress of something that started at `startMs`. Things that start at or before 0 are settled. */
export function progressSince(startMs: number | undefined, timeMs: number, durationMs: number): number {
  if (startMs === undefined || startMs <= 0) return 1;
  return clamp01((timeMs - startMs) / durationMs);
}

function lastAtOrBefore(times: readonly number[], timeMs: number): number | undefined {
  let found: number | undefined;
  for (const time of times) {
    if (time > timeMs) break;
    found = time;
  }
  return found;
}

function firstInRange(times: readonly number[], from: number, to: number): number | undefined {
  for (const time of times) {
    if (time < from) continue;
    if (time > to) return undefined;
    return time;
  }
  return undefined;
}

export const TAPBACK_EMOJI: Record<string, string> = {
  love: "❤️",
  like: "👍",
  dislike: "👎",
  laugh: "😂",
  emphasize: "‼️",
  question: "❓",
};

export function reactionEmoji(reaction: { type: string; emoji?: string }): string {
  return reaction.emoji || TAPBACK_EMOJI[reaction.type] || "👍";
}

export type ChatPerson = {
  key: string;
  name: string;
  initials: string;
  photo?: string;
  me: boolean;
  /** The conversation's contact (the agent/business), as opposed to another participant. */
  contact: boolean;
  /** Stable 0-based palette index for names/avatars. */
  colorIndex: number;
};

export type ChatReactionView = { id: string; emoji: string; byMe: boolean; enter: number };

export type ChatMessageView = {
  message: DemoMessage;
  id: string;
  side: "in" | "out";
  sender: ChatPerson;
  arrivalMs: number;
  /** 0..1 eased arrival progress. 1 once settled. */
  enter: number;
  firstOfGroup: boolean;
  lastOfGroup: boolean;
  status?: MessageStatus;
  /** 0..1 progress of the latest receipt change (used to fade grey ticks to blue). */
  statusChange: number;
  previousStatus?: MessageStatus;
  reactions: ChatReactionView[];
  /** Display clock text, e.g. "9:41 AM". */
  time: string;
  emojiOnly: boolean;
  /** Voice-note playback position 0..1 when an audio-control event targets this message. */
  audioProgress?: number;
  audioPlaying?: boolean;
};

export type ChatModel = {
  channel: ChatChannel;
  theme: "light" | "dark";
  timeMs: number;
  statusTime: string;
  contact: ChatPerson;
  me: ChatPerson;
  group: boolean;
  groupName?: string;
  participants: ChatPerson[];
  messages: ChatMessageView[];
  typing: { visible: boolean; enter: number; elapsed: number; who: ChatPerson };
  draft: { text: string; caret: boolean };
  /** First message's display day label (always "Today" for demos). */
  dayLabel: string;
};

export function initialsOf(name: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim().slice(0, 2).toUpperCase();
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function hashIndex(text: string, modulo: number): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return hash % modulo;
}

/** "9:41 AM" in UTC, matching the status bar clock's timezone handling. */
export function clockLabel(ms: number, withPeriod = true): string {
  const date = new Date(ms);
  const hour24 = date.getUTCHours();
  const hour = hour24 % 12 || 12;
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return withPeriod ? `${hour}:${minute} ${hour24 < 12 ? "AM" : "PM"}` : `${hour}:${minute}`;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;

export function isEmojiOnlyText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && EMOJI_ONLY.test(trimmed);
}

type FrameExtras = {
  audio?: { messageId: string; position: number; playing: boolean } | null;
};

/** Messages that fall within this gap from the same sender read as one group. */
const GROUP_GAP_MS = 5 * 60_000;

export function buildChatModel(compiled: CompiledDemo, frame: RenderFrame, channel: ChatChannel): ChatModel {
  const timeline = buildTimeline(compiled);
  const t = frame.timeMs;
  const roster = compiled.participants ?? [];
  const group = Boolean(compiled.group) || roster.filter((person) => !person.me).length > 1;
  const toPerson = (person: DemoParticipant, contact: boolean): ChatPerson => ({
    key: person.id,
    name: person.name,
    initials: initialsOf(person.name, person.initials),
    photo: person.photo,
    me: person.me === true,
    contact,
    colorIndex: hashIndex(person.name, 7),
  });
  const contactPerson: ChatPerson = {
    key: "contact",
    name: frame.contact.name,
    initials: initialsOf(frame.contact.name, frame.contact.initials),
    photo: frame.contact.photo,
    me: false,
    contact: true,
    colorIndex: hashIndex(frame.contact.name, 7),
  };
  const meSource = roster.find((person) => person.me);
  const me: ChatPerson = meSource ? toPerson(meSource, false) : { key: "me", name: "You", initials: "YO", me: true, contact: false, colorIndex: 5 };
  const participants = roster.filter((person) => !person.me).map((person) => {
    const isContact = person.name === frame.contact.name;
    const view = toPerson(person, isContact);
    return isContact ? { ...view, photo: view.photo ?? contactPerson.photo, colorIndex: contactPerson.colorIndex } : view;
  });

  const senderOf = (message: DemoMessage): ChatPerson => {
    if (message.direction === "outgoing") return me;
    const byId = message.senderId ? participants.find((person) => person.key === message.senderId) : undefined;
    const byName = message.sender ? participants.find((person) => person.name === message.sender) : undefined;
    const found = byId ?? byName;
    if (found) return found;
    if (message.sender && message.sender !== contactPerson.name) {
      return {
        key: `sender:${message.sender}`,
        name: message.sender,
        initials: initialsOf(message.sender, message.senderInitials),
        photo: message.senderPhoto,
        me: false,
        contact: false,
        colorIndex: hashIndex(message.sender, 7),
      };
    }
    return contactPerson;
  };

  const extras = frame as RenderFrame & FrameExtras;
  const audio = extras.audio ?? null;
  const visible = frame.messages.filter((message) => !message.removed);
  const views: ChatMessageView[] = visible.map((message) => {
    const arrivalMs = timeline.arrivals.get(message.id) ?? 0;
    const sender = senderOf(message);
    const { status, statusChange, previousStatus } = receiptFor(message, arrivalMs, t, timeline);
    const reactions = (message.reactions ?? []).map((reaction, index) => {
      const id = reaction.id || `${message.id}:${index}`;
      return {
        id,
        emoji: reactionEmoji(reaction),
        byMe: reaction.byMe ?? false,
        enter: progressSince(timeline.reactions.get(id), t, chatMotion.reaction),
      };
    });
    const display = message.atMs > 1e11 ? message.atMs : compiled.nowMs;
    const view: ChatMessageView = {
      message,
      id: message.id,
      side: message.direction === "outgoing" ? "out" : "in",
      sender,
      arrivalMs,
      enter: easeOutCubic(progressSince(arrivalMs, t, chatMotion.arrival)),
      firstOfGroup: true,
      lastOfGroup: true,
      statusChange,
      reactions,
      time: clockLabel(display),
      emojiOnly: (message.kind === undefined || message.kind === "text") && !message.replyTo && isEmojiOnlyText(message.text),
    };
    if (status) view.status = status;
    if (previousStatus) view.previousStatus = previousStatus;
    if (audio && audio.messageId === message.id && message.audio) {
      view.audioProgress = clamp01(audio.position / Math.max(0.001, message.audio.duration));
      view.audioPlaying = audio.playing;
    }
    return view;
  });
  for (let index = 0; index < views.length; index += 1) {
    const previous = views[index - 1];
    const current = views[index];
    const next = views[index + 1];
    const joins = (a: ChatMessageView | undefined, b: ChatMessageView | undefined) =>
      Boolean(a && b && a.side === b.side && a.sender.key === b.sender.key && Math.abs(displayMs(b, compiled) - displayMs(a, compiled)) < GROUP_GAP_MS);
    current.firstOfGroup = !joins(previous, current);
    current.lastOfGroup = !joins(current, next);
  }

  const typingStart = lastAtOrBefore(timeline.typingOn, t) ?? 0;
  const lastIncoming = [...views].reverse().find((view) => view.side === "in");
  const typingWho = lastIncoming?.sender ?? contactPerson;
  const lastDraftChange = lastAtOrBefore(timeline.draftChanges, t) ?? 0;
  const sinceDraft = t - lastDraftChange;
  const caret = frame.draft.length > 0 && (sinceDraft < chatMotion.caretHold || Math.floor((sinceDraft - chatMotion.caretHold) / chatMotion.caretBlink) % 2 === 1);

  return {
    channel,
    theme: frame.theme,
    timeMs: t,
    statusTime: clockLabel(frame.nowMs, false),
    contact: contactPerson,
    me,
    group,
    ...(compiled.group?.name ? { groupName: compiled.group.name } : {}),
    participants,
    messages: views,
    typing: {
      visible: frame.typing,
      enter: easeOutCubic(progressSince(typingStart, t, chatMotion.typingEnter)),
      elapsed: Math.max(0, t - typingStart),
      who: typingWho,
    },
    draft: { text: frame.draft, caret },
    dayLabel: "Today",
  };
}

function displayMs(view: ChatMessageView, compiled: CompiledDemo): number {
  return view.message.atMs > 1e11 ? view.message.atMs : compiled.nowMs + view.arrivalMs;
}

/**
 * Receipt for an outgoing message. An explicit status (authored or from status events) wins.
 * Otherwise the message reads as sent, then delivered, then read once the contact starts typing
 * or replies, which is how the real apps behave and keeps unannotated flows believable.
 */
function receiptFor(message: DemoMessage, arrivalMs: number, t: number, timeline: ChatTimeline): {
  status?: MessageStatus;
  statusChange: number;
  previousStatus?: MessageStatus;
} {
  if (message.direction !== "outgoing") return { statusChange: 1 };
  const events = (timeline.statuses.get(message.id) ?? []).filter((event) => event.atMs <= t);
  if (message.status || events.length > 0) {
    const latest = events.at(-1);
    const previous = events.at(-2)?.status ?? (latest ? message.status && message.status !== latest.status ? message.status : undefined : undefined);
    const status = latest?.status ?? message.status;
    return {
      status,
      statusChange: latest ? progressSince(latest.atMs, t, chatMotion.receipt) : 1,
      ...(previous ? { previousStatus: previous } : {}),
    };
  }
  if (arrivalMs > 0 && t - arrivalMs < 450) return { status: "sent", statusChange: 1 };
  const deliveredAt = arrivalMs > 0 ? arrivalMs + 450 : 0;
  const typingAfter = firstInRange(timeline.typingOn, arrivalMs, t);
  const replyAfter = firstInRange(timeline.incoming, arrivalMs + 1, t);
  const readAt = [typingAfter, replyAfter].filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0];
  if (readAt !== undefined) {
    return { status: "read", statusChange: progressSince(readAt, t, chatMotion.receipt), previousStatus: "delivered" };
  }
  return { status: "delivered", statusChange: progressSince(deliveredAt, t, chatMotion.receipt), previousStatus: "sent" };
}

/** Deterministic pseudo-waveform for voice notes without authored peaks. */
export function waveformBars(message: DemoMessage, count: number): number[] {
  const peaks = message.audio?.peaks;
  if (peaks && peaks.length > 0) {
    const max = Math.max(...peaks.map((peak) => Math.abs(peak)), 0.0001);
    return Array.from({ length: count }, (_, index) => {
      const source = peaks[Math.floor((index / count) * peaks.length)] ?? 0;
      return Math.max(0.12, Math.abs(source) / max);
    });
  }
  let seed = hashIndex(message.id, 2147483647) || 7;
  return Array.from({ length: count }, (_, index) => {
    seed = (seed * 48271) % 2147483647;
    const noise = seed / 2147483647;
    const envelope = 0.45 + 0.55 * Math.sin((index / count) * Math.PI);
    return Math.max(0.14, Math.min(1, envelope * (0.35 + noise * 0.75)));
  });
}

export function durationLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Split text into plain and URL runs so skins can colour links. */
export function linkRuns(text: string): Array<{ text: string; url: boolean }> {
  const runs: Array<{ text: string; url: boolean }> = [];
  // Full URLs, or bare domains (one or more labels plus a 2-12 letter TLD) with an optional path.
  const pattern = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,12}(?![a-z0-9-])(?:\/[^\s]*)?/gi;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    let value = match[0];
    const trailing = /[.,!?)]+$/.exec(value)?.[0] ?? "";
    if (trailing) value = value.slice(0, -trailing.length);
    if (start > cursor) runs.push({ text: text.slice(cursor, start), url: false });
    runs.push({ text: value, url: true });
    cursor = start + value.length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), url: false });
  return runs;
}

export function hostOf(link: { url: string; host?: string }): string {
  if (link.host) return link.host;
  try {
    return new URL(link.url.includes("://") ? link.url : `https://${link.url}`).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

/** Message kinds the chat skins draw natively; anything else falls back to its text. */
export const CHAT_MESSAGE_KINDS = new Set(["text", "link", "image", "attachment", "audio", "video"]);
