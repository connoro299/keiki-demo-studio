import { validateSheetSpec, type SheetValidationContext } from "@/generator/sheet-request";
import { APP_CARD_MAX_HEIGHT, APP_CARD_MIN_HEIGHT, MESSAGES_CHANNELS, miniAppLayoutSchema, appCardPayloadSchema } from "@/contracts";
import type {
  AppCardPayload,
  BubbleEffectName,
  CompiledEvent,
  DemoFlow,
  DemoMessage,
  DemoChannel,
  DemoPlatform,
  DemoTheme,
  Direction,
  IosScreenName,
  MessageKind,
  MessageStatus,
  OverlayState,
  PickerSelection,
  Reaction,
  ScreenEffectName,
  Service,
  SystemNotice,
  ValidationIssue,
  ValidationResult,
} from "@/contracts";
import capabilities from "@/contracts/capabilities.json";
import { isPlainObject, issue, pointer } from "./issues";
import { readMessageExtras } from "./message-extras";
import { arrivalWindow, bubbleEffectDurationMs } from "./motion";

const MESSAGE_KINDS = new Set<MessageKind>(["text", "link", "attachment", "image", "audio", "app-card", "system", "facetime", "sticker", "poll", "video"]);
/** Decorations the thread would draw on the hidden placeholder row rather than on the live card. */
const APP_CARD_EXCLUDED_FIELDS = ["status", "reactions", "replyTo", "edited"] as const;
/** Query parameters the renderer appends to an app card URL itself. */
const APP_CARD_RENDERER_PARAMS = ["presentation", "parentOrigin"] as const;
const DIRECTIONS = new Set<Direction>(["incoming", "outgoing"]);
const SERVICES = new Set<Service>(["imessage", "sms"]);
const STATUSES = new Set<MessageStatus>(["sending", "sent", "delivered", "read", "failed"]);
const PLATFORMS = new Set<DemoPlatform>(["ios", "macos"]);
const CHANNELS = new Set<DemoChannel>(["imessage", "sms", "whatsapp", "telegram", "slack"]);
const THEMES = new Set<DemoTheme>(["light", "dark"]);
const SCREENS = new Set<IosScreenName>(["list", "conversation", "new-message"]);
const EFFECTS = new Set<BubbleEffectName>(["slam", "loud", "gentle", "invisible-ink"]);
const SCREEN_EFFECTS = new Set<ScreenEffectName>(["echo", "spotlight", "balloons", "confetti", "love", "lasers", "fireworks", "celebration"]);
const IOS_ONLY_SCREENS = new Set<IosScreenName>(["list", "new-message"]);
const IOS_ONLY_OVERLAYS = new Set<OverlayState["kind"]>([
  "long-press",
  "plus-menu",
  "effects-picker",
  "image-viewer",
  "details",
  "photo-picker",
  "selection",
  "search",
  "recorder",
  "tapback-details",
  "sticker-picker",
  "poll-details",
]);

const ROOT_FIELDS = new Set([
  "id",
  "title",
  "platform",
  "channel",
  "theme",
  "contact",
  "nowMs",
  "startAtMs",
  "draft",
  "typing",
  "screen",
  "messages",
  "events",
  "participants",
  "group",
  "conversations",
  "selectedConversationId",
  "library",
]);

const MESSAGE_FIELDS = new Set([
  "id",
  "text",
  "direction",
  "atMs",
  "kind",
  "service",
  "status",
  "effect",
  "link",
  "attachments",
  "images",
  "audio",
  "appCard",
  "replyTo",
  "reactions",
  "edited",
  "readAt",
  "sentAt",
  "removed",
  "revealed",
  "replyCount",
  "platforms",
  "sender",
  "senderId",
  "senderInitials",
  "senderPhoto",
  "conversationId",
  "system",
  "facetime",
  "sticker",
  "stickers",
  "poll",
  "video",
]);

const unsupportedReason = new Map(capabilities.unsupported.map((entry) => [entry.id, entry.reason]));
const catalogueReason = new Map(capabilities.catalogueOnly.map((entry) => [entry.id, entry.reason]));

const unsupportedKinds = new Map<string, string>([
  ["mini-app", "mini-apps"],
  ["mini-apps", "mini-apps"],
  ["miniapp", "mini-apps"],
  ["photon", "mini-apps"],
  ["photon-mini-app", "mini-apps"],
]);

const catalogueKinds = new Map<string, string>([
  ["ios-list", "ios-list"],
  ["mac-context-menu", "mac-context-menu"],
  ["mac-plus-menu", "mac-plus-menu"],
]);

type ReplyRef = {
  id: string;
  conversationId?: string;
  text?: string;
  direction?: string;
  service?: Service;
  sender?: string;
};

type ParsedReaction = {
  id?: string;
  type: string;
  byMe?: boolean;
  emoji?: string;
  target?: string;
};

type MessageMeta = {
  index: number;
  id?: string;
  text: string;
  direction?: Direction;
  kind?: MessageKind;
  effect?: BubbleEffectName;
  atMs?: number;
  reply: ReplyRef | null;
  removed?: boolean;
  edited?: boolean;
  hasReactions: boolean;
  reactionTargets: string[];
  readAt?: "valid" | "invalid";
  readAtValue?: number;
  sentAt?: "valid" | "invalid";
  sentAtValue?: number;
  kindBlocked: boolean;
  reactionItems: ParsedReaction[];
  imageCount: number;
  audioDuration?: number;
};

export function validateDemo(input: unknown, context?: SheetValidationContext): ValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, issues: [issue("/", "INVALID_TYPE", "demo must be a JSON object")] };
  }
  if (Object.hasOwn(input, "steps") && !Object.hasOwn(input, "messages")) {
    return { ok: false, issues: stepsOnlyIssues(input) };
  }

  const { issues, demo } = validateFlow(input);
  if (demo) {
    const messages = [...demo.messages, ...(demo.events ?? []).flatMap(e => e.type === "message" ? [e.message] : [])];
    for (const message of messages) if (message.appCard?.app === 'sheet') {
      for (const error of validateSheetSpec(message.appCard.sheet, context)) issues.push(issue(`/messages/${message.id}/appCard/sheet`, 'INVALID_VALUE', error));
    }
  }
  if (Object.hasOwn(input, "steps")) {
    issues.push(...stepComponentIssues(input.steps));
  }
  if (issues.length > 0 || !demo) return { ok: false, issues };
  return { ok: true, demo };
}

function stepsOnlyIssues(input: Record<string, unknown>): ValidationIssue[] {
  const inspected = stepComponentIssues(input.steps);
  if (inspected.length > 0) return inspected;
  return [
    issue(
      "/steps",
      "CONTRACT_GAP",
      "the frozen DemoFlow has no steps timeline, so this document cannot compile",
    ),
  ];
}

function stepComponentIssues(steps: unknown): ValidationIssue[] {
  if (!Array.isArray(steps)) {
    return [issue("/steps", "INVALID_TYPE", "steps must be an array")];
  }
  const issues: ValidationIssue[] = [];
  steps.forEach((step, index) => {
    if (!isPlainObject(step) || !isPlainObject(step.message) || !Object.hasOwn(step.message, "kind")) return;
    const stepId = typeof step.id === "string" && step.id.length > 0 ? step.id : undefined;
    classifyKind(step.message.kind, pointer(["steps", index, "message", "kind"]), issues, stepId ? `stepId=${stepId}` : undefined);
  });
  return issues;
}

function classifyKind(kind: unknown, path: string, issues: ValidationIssue[], note?: string): boolean {
  const suffix = note ? ` (${note})` : "";
  if (typeof kind !== "string") {
    issues.push(issue(path, "INVALID_TYPE", `kind must be a string${suffix}`));
    return true;
  }
  const unsupported = unsupportedKinds.get(kind);
  if (unsupported) {
    const reason = unsupportedReason.get(unsupported) ?? `${unsupported} is not a pinned component`;
    issues.push(issue(path, "UNSUPPORTED_COMPONENT", `${reason}${suffix}`));
    return true;
  }
  const catalogue = catalogueKinds.get(kind);
  if (catalogue) {
    const reason = catalogueReason.get(catalogue) ?? `${catalogue} is catalogue-only`;
    issues.push(issue(path, "CATALOGUE_ONLY", `${reason}${suffix}`));
    return true;
  }
  if (kind === "typing") {
    issues.push(
      issue(
        path,
        "INVALID_VALUE",
        `typing is the conversation flag, not a message kind${suffix}`,
      ),
    );
    return true;
  }
  if (!MESSAGE_KINDS.has(kind as MessageKind)) {
    issues.push(issue(path, "INVALID_VALUE", `unknown message kind ${JSON.stringify(kind)}${suffix}`));
    return true;
  }
  return false;
}

function validateFlow(input: Record<string, unknown>): { issues: ValidationIssue[]; demo?: DemoFlow } {
  const issues: ValidationIssue[] = [];
  const id = readBoundedString(input, "id", pointer(["id"]), issues, false);
  const title = readBoundedString(input, "title", pointer(["title"]), issues, false);
  const platform = readEnum(input, "platform", pointer(["platform"]), issues, PLATFORMS);
  const channel = Object.hasOwn(input, "channel") ? readEnum(input, "channel", pointer(["channel"]), issues, CHANNELS) : undefined;
  if (channel && !MESSAGES_CHANNELS.has(channel) && platform === "macos") {
    issues.push(issue(pointer(["channel"]), "PLATFORM_MISMATCH", `${channel} demos render in an iOS-sized phone frame; use platform "ios"`));
  }
  const theme = readEnum(input, "theme", pointer(["theme"]), issues, THEMES);
  const contact = readContact(input.contact, Object.hasOwn(input, "contact"), issues);
  const nowMs = readMillis(input, "nowMs", pointer(["nowMs"]), issues, true);
  const startAtMs = readMillis(input, "startAtMs", pointer(["startAtMs"]), issues, false);
  // Messages authored before startAtMs are thread history: already present and settled when
  // playback opens (no arrival motion). Timeline events still cannot precede startAtMs.
  const draft = readDraft(input, issues);
  const typing = readBoolean(input, "typing", pointer(["typing"]), issues, true);
  const screen = readEnum(input, "screen", pointer(["screen"]), issues, SCREENS);

  if (platform === "macos" && screen && IOS_ONLY_SCREENS.has(screen)) {
    issues.push(
      issue(
        pointer(["screen"]),
        "PLATFORM_MISMATCH",
        `${screen} is an iOS shell screen and is not a macOS target`,
      ),
    );
  }

  const derived: CompiledEvent[] = [];
  const messages = readMessages(input, issues, typeof id === "string" ? id : undefined, platform, derived);
  const events = readTimeline(input, issues, platform);
  if (channel && CHAT_RENDERER_CHANNELS.has(channel)) issues.push(...chatChannelIssues(input, channel, screen));

  for (const key of Object.keys(input)) {
    if (ROOT_FIELDS.has(key)) continue;
    issues.push(issue(pointer([key]), "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
  }

  if (
    issues.length > 0 ||
    id === undefined ||
    title === undefined ||
    platform === undefined ||
    theme === undefined ||
    contact === undefined ||
    nowMs === undefined ||
    draft === undefined ||
    typing === undefined ||
    screen === undefined ||
    messages === undefined ||
    events === undefined
  ) {
    return { issues };
  }

  const demo: DemoFlow = { id, title, platform, theme, contact, nowMs, draft, typing, screen, messages };
  if (startAtMs !== undefined) demo.startAtMs = startAtMs;
  if (channel !== undefined) demo.channel = channel;
  const roster = readRoster(input, issues, platform);
  if (roster.participants) demo.participants = roster.participants;
  if (roster.group) demo.group = roster.group;
  if (roster.conversations) demo.conversations = roster.conversations;
  if (roster.selectedConversationId) demo.selectedConversationId = roster.selectedConversationId;
  if (roster.library) demo.library = roster.library;
  const timeline = [...derived, ...events];
  if (timeline.length > 0) demo.events = timeline;
  auditPollVoters(demo, issues);
  return { issues, demo };
}

/** Channels drawn by the repository-owned chat renderers (src/renderers/chat). */
const CHAT_RENDERER_CHANNELS = new Set<DemoChannel>(["whatsapp", "telegram", "slack"]);
const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", telegram: "Telegram", slack: "Slack" };
/** Message kinds that only exist in the Messages UI. */
const MESSAGES_ONLY_KINDS = new Set(["app-card", "poll", "facetime", "sticker", "system"]);
/** Message payload fields that only the Messages UI can show. */
const MESSAGES_ONLY_FIELDS = ["effect", "appCard", "poll", "facetime", "sticker", "stickers", "system", "revealed"] as const;
/** Timeline events the chat renderers cannot show: iOS overlays, effects, navigation, sheets, polls, stickers. */
const MESSAGES_ONLY_EVENTS = new Set([
  "overlay", "screen-effect", "screen", "select-conversation", "sheet-app", "poll-option", "poll-vote",
  "sticker", "notice", "time-reveal", "reveal", "scroll", "window-active",
]);

/**
 * WhatsApp, Telegram and Slack demos render one iPhone conversation with text, links, images,
 * files, voice notes, video, reactions, replies, receipts, typing and drafts. Everything else is
 * reported as UNSUPPORTED_FOR_CHANNEL instead of being silently dropped.
 */
function chatChannelIssues(input: Record<string, unknown>, channel: DemoChannel, screen: IosScreenName | undefined): ValidationIssue[] {
  const label = CHANNEL_LABELS[channel] ?? channel;
  const issues: ValidationIssue[] = [];
  const unsupported = (path: string, what: string) => issues.push(issue(path, "UNSUPPORTED_FOR_CHANNEL", `${what} is not available in ${label} demos`));
  if (screen && screen !== "conversation") unsupported(pointer(["screen"]), `screen "${screen}"`);
  for (const key of ["conversations", "selectedConversationId"] as const) {
    if (Object.hasOwn(input, key)) unsupported(pointer([key]), `${key} (a Messages conversation list)`);
  }
  const auditMessage = (message: unknown, base: Array<string | number>) => {
    if (!isPlainObject(message)) return;
    if (typeof message.kind === "string" && MESSAGES_ONLY_KINDS.has(message.kind)) unsupported(pointer([...base, "kind"]), `message kind "${message.kind}"`);
    for (const field of MESSAGES_ONLY_FIELDS) {
      if (Object.hasOwn(message, field)) unsupported(pointer([...base, field]), field === "effect" ? "a bubble effect" : `the iMessage ${field} field`);
    }
  };
  if (Array.isArray(input.messages)) input.messages.forEach((message, index) => auditMessage(message, ["messages", index]));
  if (Array.isArray(input.events)) {
    input.events.forEach((event, index) => {
      if (!isPlainObject(event) || typeof event.type !== "string") return;
      if (MESSAGES_ONLY_EVENTS.has(event.type)) {
        const detail = event.type === "overlay" && isPlainObject(event.overlay) && typeof event.overlay.kind === "string" ? ` (${event.overlay.kind})` : "";
        unsupported(pointer(["events", index, "type"]), `the ${event.type} event${detail}`);
      }
      if (event.type === "message") auditMessage(event.message, ["events", index, "message"]);
    });
  }
  return issues;
}

function auditPollVoters(demo: DemoFlow, issues: ValidationIssue[]): void {
  const known = new Set<string>(["me"]);
  for (const person of demo.participants ?? []) known.add(person.id);
  demo.messages.forEach((message, index) => {
    if (!message.poll || (message.poll.voters?.length ?? 0) > 0) return;
    message.poll.votes?.forEach((vote, voteIndex) => {
      if (known.has(vote.participantId)) return;
      issues.push(issue(pointer(["messages", index, "poll", "votes", voteIndex, "participantId"]), "INVALID_REFERENCE", `vote names unknown participant ${JSON.stringify(vote.participantId)}`));
    });
  });
  demo.events?.forEach((event, index) => {
    if (event.type !== "poll-vote") return;
    const message = demo.messages.find((item) => item.id === event.messageId);
    if ((message?.poll?.voters?.length ?? 0) > 0) return;
    if (known.has(event.participantId)) return;
    issues.push(issue(pointer(["events", index, "participantId"]), "INVALID_REFERENCE", `poll-vote names unknown participant ${JSON.stringify(event.participantId)}`));
  });
}

function readRoster(input: Record<string, unknown>, issues: ValidationIssue[], platform: DemoPlatform | undefined): Pick<DemoFlow, "participants" | "group" | "conversations" | "selectedConversationId" | "library"> {
  const roster: Pick<DemoFlow, "participants" | "group" | "conversations" | "selectedConversationId" | "library"> = {};
  const iosOnly = (path: string, label: string) => {
    if (platform === "macos") issues.push(issue(path, "PLATFORM_MISMATCH", `${label} is an iOS conversation feature and is not a macOS target`));
  };
  if (Object.hasOwn(input, "participants")) {
    iosOnly(pointer(["participants"]), "participants");
    if (!Array.isArray(input.participants)) issues.push(issue(pointer(["participants"]), "INVALID_TYPE", "participants must be an array"));
    else {
      const people = [];
      const ids = new Set<string>();
      for (const [index, person] of input.participants.entries()) {
        if (!isPlainObject(person) || typeof person.id !== "string" || typeof person.name !== "string" || person.id.length === 0 || person.name.length === 0) {
          issues.push(issue(pointer(["participants", index]), "INVALID_VALUE", "each participant needs an id and a name"));
          continue;
        }
        if (ids.has(person.id)) issues.push(issue(pointer(["participants", index, "id"]), "DUPLICATE_ID", `duplicate participant id ${JSON.stringify(person.id)}`));
        ids.add(person.id);
        people.push({
          id: person.id,
          name: person.name,
          ...(typeof person.initials === "string" ? { initials: person.initials } : {}),
          ...(typeof person.photo === "string" ? { photo: person.photo } : {}),
          ...(typeof person.me === "boolean" ? { me: person.me } : {}),
        });
      }
      roster.participants = people;
    }
  }
  if (Object.hasOwn(input, "group")) {
    iosOnly(pointer(["group"]), "group");
    if (!isPlainObject(input.group)) issues.push(issue(pointer(["group"]), "INVALID_TYPE", "group must be an object"));
    else {
      roster.group = {
        ...(typeof input.group.name === "string" ? { name: input.group.name } : {}),
        ...(typeof input.group.photo === "string" ? { photo: input.group.photo } : {}),
      };
    }
  }
  if (Object.hasOwn(input, "conversations")) {
    iosOnly(pointer(["conversations"]), "conversations");
    if (!Array.isArray(input.conversations)) issues.push(issue(pointer(["conversations"]), "INVALID_TYPE", "conversations must be an array"));
    else {
      roster.conversations = input.conversations.flatMap((conversation, index) => {
        if (!isPlainObject(conversation) || typeof conversation.id !== "string" || !isPlainObject(conversation.contact) || typeof conversation.contact.name !== "string") {
          issues.push(issue(pointer(["conversations", index]), "INVALID_VALUE", "each conversation needs an id and a contact name"));
          return [];
        }
        return [{
          id: conversation.id,
          contact: {
            name: conversation.contact.name,
            ...(typeof conversation.contact.initials === "string" ? { initials: conversation.contact.initials } : {}),
            ...(typeof conversation.contact.photo === "string" ? { photo: conversation.contact.photo } : {}),
            ...(typeof conversation.contact.silhouette === "boolean" ? { silhouette: conversation.contact.silhouette } : {}),
          },
        }];
      });
    }
  }
  if (typeof input.selectedConversationId === "string") roster.selectedConversationId = input.selectedConversationId;
  if (Object.hasOwn(input, "library")) {
    if (!Array.isArray(input.library)) issues.push(issue(pointer(["library"]), "INVALID_TYPE", "library must be an array"));
    else {
      roster.library = input.library.flatMap((photo, index) => {
        if (!isPlainObject(photo) || typeof photo.id !== "string" || typeof photo.src !== "string" || typeof photo.alt !== "string") {
          issues.push(issue(pointer(["library", index]), "INVALID_VALUE", "each library photo needs an id, src, and alt"));
          return [];
        }
        return [{ id: photo.id, src: photo.src, alt: photo.alt }];
      });
    }
  }
  return roster;
}

function readMessages(
  input: Record<string, unknown>,
  issues: ValidationIssue[],
  flowId: string | undefined,
  flowPlatform: DemoPlatform | undefined,
  derived: CompiledEvent[] = [],
): DemoMessage[] | undefined {
  if (!Object.hasOwn(input, "messages")) {
    issues.push(issue(pointer(["messages"]), "MISSING_FIELD", "missing messages"));
    return undefined;
  }
  if (!Array.isArray(input.messages)) {
    issues.push(issue(pointer(["messages"]), "INVALID_TYPE", "messages must be an array"));
    return undefined;
  }

  const metas: ReadMessage[] = [];
  const normalized: DemoMessage[] = [];
  const seen = new Map<string, number>();
  let previousAt: number | undefined;
  let messagesValid = true;

  input.messages.forEach((value, index) => {
    const base = pointer(["messages", index]);
    if (!isPlainObject(value)) {
      messagesValid = false;
      issues.push(issue(base, "INVALID_TYPE", "message must be an object"));
      return;
    }
    const before = issues.length;
    const meta = readMessage(value, index, base, issues, seen, previousAt, flowPlatform);
    metas.push(meta);
    if (meta.atMs !== undefined) previousAt = meta.atMs;
    if (issues.length !== before) messagesValid = false;
    else if (meta.normalized) normalized.push(meta.normalized);
  });

  semanticPass(metas, flowId, issues, derived);
  if (issues.length > 0) messagesValid = false;
  return messagesValid ? normalized : undefined;
}

type ReadMessage = MessageMeta & { normalized?: DemoMessage };

function readMessage(
  value: Record<string, unknown>,
  index: number,
  base: string,
  issues: ValidationIssue[],
  seen: Map<string, number>,
  previousAt: number | undefined,
  flowPlatform: DemoPlatform | undefined,
): ReadMessage {
  const id = readBoundedString(value, "id", `${base}/id`, issues, false);
  if (id !== undefined) {
    const first = seen.get(id);
    if (first !== undefined) {
      issues.push(issue(`${base}/id`, "DUPLICATE_ID", `duplicate message id ${JSON.stringify(id)} also appears at sourceIndex ${first}`));
    } else {
      seen.set(id, index);
    }
  }
  const text = readText(value, `${base}/text`, issues);
  const direction = readEnum(value, "direction", `${base}/direction`, issues, DIRECTIONS);
  const atMs = readMillis(value, "atMs", `${base}/atMs`, issues, true);
  if (atMs !== undefined && previousAt !== undefined && atMs < previousAt) {
    issues.push(
      issue(
        `${base}/atMs`,
        "INVALID_TIMESTAMP",
        `atMs ${atMs} is earlier than sourceIndex ${index - 1} at ${previousAt}; authored times must be nondecreasing`,
      ),
    );
  }

  let kind: MessageKind | undefined;
  let kindBlocked = false;
  if (Object.hasOwn(value, "kind")) {
    kindBlocked = classifyKind(value.kind, `${base}/kind`, issues, id ? `id=${id}` : undefined);
    if (!kindBlocked && typeof value.kind === "string") kind = value.kind as MessageKind;
  }

  const service = readOptionalEnum(value, "service", `${base}/service`, issues, SERVICES);
  const status = readOptionalEnum(value, "status", `${base}/status`, issues, STATUSES);
  const effect = readEffect(value, base, issues, kind, kindBlocked, direction);

  const effectiveKind = kind ?? "text";
  const link = readOwnedPayload(value, "link", !kindBlocked && effectiveKind === "link", kindBlocked, () =>
    readLink(value, base, issues, !kindBlocked && effectiveKind === "link"),
  );
  const attachments = readOwnedPayload(value, "attachments", !kindBlocked && effectiveKind === "attachment", kindBlocked, () =>
    readAttachments(value, base, issues, !kindBlocked && effectiveKind === "attachment"),
  );
  const images = readOwnedPayload(value, "images", !kindBlocked && effectiveKind === "image", kindBlocked, () =>
    readImages(value, base, issues, !kindBlocked && effectiveKind === "image"),
  );
  const audio = readOwnedPayload(value, "audio", !kindBlocked && effectiveKind === "audio", kindBlocked, () =>
    readAudio(value, base, issues, !kindBlocked && effectiveKind === "audio"),
  );
  const appCard = readOwnedPayload(value, "appCard", !kindBlocked && effectiveKind === "app-card", kindBlocked, () =>
    readAppCard(value, base, issues, !kindBlocked && effectiveKind === "app-card"),
  );

  if (!kindBlocked) {
    rejectForeignPayload(value, base, effectiveKind, issues);
  }
  if (!kindBlocked && effectiveKind === "app-card") {
    rejectAppCardDecorations(value, base, issues, flowPlatform);
  }

  const reply = readReply(value, base, issues);
  const reactions = readReactions(value, base, issues);
  const edited = readEdited(value, base, issues);
  const removed = readRemoved(value, base, issues);
  if (Object.hasOwn(value, "revealed") && typeof value.revealed !== "boolean") {
    issues.push(issue(`${base}/revealed`, "INVALID_TYPE", "revealed must be a boolean"));
  }
  const readAt = readOptionalMillis(value, "readAt", `${base}/readAt`, issues);
  const sentAt = readOptionalMillis(value, "sentAt", `${base}/sentAt`, issues);
  readReplyCount(value, base, issues);
  readPlatforms(value, base, issues, flowPlatform);

  for (const key of Object.keys(value)) {
    if (MESSAGE_FIELDS.has(key)) continue;
    issues.push(issue(`${base}/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
  }

  const meta: ReadMessage = {
    index,
    id,
    text: text ?? "",
    direction,
    kind,
    effect,
    atMs,
    reply,
    removed,
    edited,
    hasReactions: reactions.present,
    reactionTargets: reactions.targets,
    readAt: readAt === "absent" ? undefined : readAt === "invalid" ? "invalid" : "valid",
    readAtValue: typeof readAt === "number" ? readAt : undefined,
    sentAt: sentAt === "absent" ? undefined : sentAt === "invalid" ? "invalid" : "valid",
    sentAtValue: typeof sentAt === "number" ? sentAt : undefined,
    kindBlocked,
    reactionItems: reactions.items,
    imageCount: Array.isArray(images) ? images.length : 0,
    audioDuration: audio && audio !== "invalid" ? audio.duration : undefined,
  };

  if (
    id !== undefined &&
    text !== undefined &&
    direction !== undefined &&
    atMs !== undefined &&
    link !== "invalid" &&
    attachments !== "invalid" &&
    images !== "invalid" &&
    audio !== "invalid" &&
    appCard !== "invalid"
  ) {
    const normalized: DemoMessage = { id, text, direction, atMs };
    if (kind !== undefined) normalized.kind = kind;
    if (service !== undefined) normalized.service = service;
    if (status !== undefined) normalized.status = status;
    if (effect !== undefined) normalized.effect = effect;
    if (link) normalized.link = link;
    if (attachments) normalized.attachments = attachments;
    if (images) normalized.images = images;
    if (audio) normalized.audio = audio;
    if (appCard) normalized.appCard = appCard;
    if (typeof value.revealed === "boolean") normalized.revealed = value.revealed;
    const extras = readMessageExtras(value, base, kind, flowPlatform, issues);
    if (extras === "invalid") return meta;
    Object.assign(normalized, extras);
    if (normalized.audio && isPlainObject(value.audio) && typeof value.audio.src === "string") {
      normalized.audio = { ...normalized.audio, src: value.audio.src };
    }
    meta.normalized = normalized;
  }
  return meta;
}

function rejectForeignPayload(
  value: Record<string, unknown>,
  base: string,
  kind: MessageKind,
  issues: ValidationIssue[],
): void {
  const allowed = new Set(
    kind === "link"
      ? ["link"]
      : kind === "attachment"
        ? ["attachments"]
        : kind === "image"
          ? ["images"]
          : kind === "audio"
            ? ["audio"]
            : kind === "app-card"
              ? ["appCard"]
              : [],
  );
  for (const field of ["link", "attachments", "images", "audio", "appCard"] as const) {
    if (!Object.hasOwn(value, field) || allowed.has(field)) continue;
    issues.push(
      issue(
        `${base}/${field}`,
        "INVALID_VALUE",
        `${field} is not a payload of kind ${JSON.stringify(kind === "text" && !Object.hasOwn(value, "kind") ? "text" : kind)}`,
      ),
    );
  }
}

function toReaction(reaction: ParsedReaction, messageId: string, index: number): Reaction {
  const stored: Reaction = { id: reaction.id || `${messageId}:${index}`, type: reaction.type };
  if (reaction.byMe !== undefined) stored.byMe = reaction.byMe;
  if (reaction.emoji !== undefined) stored.emoji = reaction.emoji;
  return stored;
}

function semanticPass(messages: ReadMessage[], flowId: string | undefined, issues: ValidationIssue[], derived: CompiledEvent[]): void {
  const byId = new Map<string, MessageMeta>();
  for (const message of messages) {
    if (message.id && !byId.has(message.id)) byId.set(message.id, message);
  }

  const windows: Array<{ message: MessageMeta; window: NonNullable<ReturnType<typeof arrivalWindow>> }> = [];

  for (const message of messages) {
    const base = pointer(["messages", message.index]);
    const idNote = message.id ? ` (id=${message.id})` : "";

    if (message.removed === true && (message.edited === true || message.hasReactions)) {
      issues.push(
        issue(
          `${base}/removed`,
          "INVALID_REFERENCE",
          `removed message cannot be edited or reacted to${idNote}`,
        ),
      );
    }

    if (message.reply) {
      const target = byId.get(message.reply.id);
      const targetIndex = target?.index;
      const forward = !target || targetIndex === undefined || targetIndex >= message.index;
      if (message.reply.conversationId !== undefined && flowId !== undefined && message.reply.conversationId !== flowId) {
        issues.push(
          issue(
            `${base}/replyTo`,
            "INVALID_REFERENCE",
            `reply crosses conversations ${JSON.stringify(message.reply.conversationId)} and ${JSON.stringify(flowId)}${idNote}`,
          ),
        );
      } else if (forward) {
        issues.push(
          issue(
            `${base}/replyTo`,
            "INVALID_REFERENCE",
            `reply target ${JSON.stringify(message.reply.id)} is not an earlier message in this conversation${idNote}`,
          ),
        );
      } else if (target?.removed === true) {
        issues.push(
          issue(
            `${base}/replyTo`,
            "INVALID_REFERENCE",
            `reply target ${JSON.stringify(message.reply.id)} is removed${idNote}`,
          ),
        );
      } else if (
        message.reply.text !== undefined &&
        target &&
        target.edited !== true &&
        message.reply.text !== target.text
      ) {
        issues.push(
          issue(
            `${base}/replyTo`,
            "INVALID_VALUE",
            `reply quote does not match the target text at creation${idNote}`,
          ),
        );
      } else if (
        message.reply.direction !== undefined &&
        target?.direction !== undefined &&
        message.reply.direction !== target.direction
      ) {
        issues.push(
          issue(
            `${base}/replyTo`,
            "INVALID_VALUE",
            `reply quote direction does not match the target${idNote}`,
          ),
        );
      } else if (target && message.normalized) {
        const direction = (message.reply.direction ?? target.direction) as Direction | undefined;
        if (direction) {
          message.normalized.replyTo = {
            id: message.reply.id,
            text: message.reply.text ?? target.text,
            direction,
          };
          if (message.reply.service) message.normalized.replyTo.service = message.reply.service;
          if (message.reply.sender !== undefined) message.normalized.replyTo.sender = message.reply.sender;
        }
      }
    }

    let reactionRefsOk = true;
    for (const targetId of message.reactionTargets) {
      if (targetId === message.id) continue;
      const target = byId.get(targetId);
      if (!target || target.removed === true || target.index >= message.index) {
        reactionRefsOk = false;
        issues.push(
          issue(
            `${base}/reactions`,
            "INVALID_REFERENCE",
            `reaction target ${JSON.stringify(targetId)} is not an earlier live message${idNote}`,
          ),
        );
      }
    }
    if (message.hasReactions && message.removed !== true && reactionRefsOk && message.normalized) {
      const own = message.reactionItems.filter((reaction) => reaction.target === undefined || reaction.target === message.id);
      if (own.length > 0) {
        message.normalized.reactions = own.map((reaction, index) => toReaction(reaction, message.id ?? String(message.index), index));
      }
      message.reactionItems.forEach((reaction, index) => {
        if (reaction.target === undefined || reaction.target === message.id || message.atMs === undefined) return;
        const stored = toReaction(reaction, reaction.target, index);
        derived.push({
          type: "reaction",
          atMs: message.atMs,
          messageId: reaction.target,
          reactionId: stored.id,
          reaction: { type: stored.type, ...(stored.byMe !== undefined ? { byMe: stored.byMe } : {}), ...(stored.emoji !== undefined ? { emoji: stored.emoji } : {}) },
        });
      });
    }

    if (message.edited === true && message.removed !== true) {
      const kind = message.kind ?? "text";
      if (message.direction !== "outgoing" || kind !== "text" || message.kindBlocked) {
        issues.push(
          issue(
            `${base}/edited`,
            "INVALID_VALUE",
            `edit target must be outgoing text${idNote}`,
          ),
        );
      } else if (message.normalized) {
        message.normalized.edited = true;
      }
    } else if (message.edited === false && message.normalized) {
      message.normalized.edited = false;
    }

    if (message.removed === true) {
      const liveReplies = messages.filter(
        (other) => other.reply?.id === message.id && other.removed !== true && other.index !== message.index,
      );
      if (liveReplies.length > 0) {
        const ids = liveReplies.map((other) => other.id ?? String(other.index)).join(", ");
        issues.push(
          issue(
            `${base}/removed`,
            "INVALID_REFERENCE",
            `cannot remove ${JSON.stringify(message.id)} while live replies remain: ${ids}`,
          ),
        );
      } else if (message.normalized) {
        message.normalized.removed = true;
      }
    } else if (message.removed === false && message.normalized) {
      message.normalized.removed = false;
    }

    if (message.readAtValue !== undefined && message.normalized) {
      message.normalized.readAt = message.readAtValue;
    }
    if (message.sentAtValue !== undefined && message.normalized) {
      message.normalized.sentAt = message.sentAtValue;
    }

    if (
      message.atMs === undefined ||
      message.direction === undefined ||
      message.kindBlocked ||
      (message.kind !== undefined && message.kind !== "text") ||
      message.effect === "invisible-ink"
    ) {
      continue;
    }
    const window = arrivalWindow({
      atMs: message.atMs,
      direction: message.direction,
      effect: message.effect,
      kind: message.kind,
    });
    if (!window) continue;
    for (const earlier of windows) {
      if (window.start < earlier.window.end && earlier.window.start < window.end) {
        issues.push(
          issue(
            `${base}/atMs`,
            "OVERLAPPING_ARRIVAL",
            `message ${JSON.stringify(message.id)} at sourceIndex ${message.index} arrives during the ${earlier.window.label} of ${JSON.stringify(earlier.message.id)} (${earlier.window.durationMs}ms) and would cancel it`,
          ),
        );
      }
    }
    windows.push({ message, window });
  }
}

function readOwnedPayload<T>(
  value: Record<string, unknown>,
  field: string,
  allowed: boolean,
  kindBlocked: boolean,
  read: () => T,
): T | undefined {
  if (kindBlocked) return undefined;
  if (!allowed && Object.hasOwn(value, field)) return undefined;
  return read();
}

function readReply(value: Record<string, unknown>, base: string, issues: ValidationIssue[]): ReplyRef | null {
  if (!Object.hasOwn(value, "replyTo")) return null;
  const reply = value.replyTo;
  if (typeof reply === "string" && reply.length > 0) return { id: reply };
  if (!isPlainObject(reply)) {
    issues.push(issue(`${base}/replyTo`, "INVALID_TYPE", "replyTo must be an id or a quote snapshot"));
    return null;
  }
  if (typeof reply.id !== "string" || reply.id.length === 0) {
    issues.push(issue(`${base}/replyTo/id`, "INVALID_VALUE", "replyTo.id must be a non-empty string"));
    return null;
  }
  const parsed: ReplyRef = { id: reply.id };
  if (Object.hasOwn(reply, "conversationId")) {
    if (typeof reply.conversationId !== "string" || reply.conversationId.length === 0) {
      issues.push(issue(`${base}/replyTo/conversationId`, "INVALID_VALUE", "conversationId must be a non-empty string"));
    } else {
      parsed.conversationId = reply.conversationId;
    }
  }
  if (Object.hasOwn(reply, "text")) {
    if (typeof reply.text !== "string") {
      issues.push(issue(`${base}/replyTo/text`, "INVALID_TYPE", "reply quote text must be a string"));
    } else {
      parsed.text = reply.text;
    }
  }
  if (Object.hasOwn(reply, "direction")) {
    if (!DIRECTIONS.has(reply.direction as Direction)) {
      issues.push(issue(`${base}/replyTo/direction`, "INVALID_VALUE", "reply quote direction must be incoming or outgoing"));
    } else {
      parsed.direction = reply.direction as string;
    }
  }
  for (const key of Object.keys(reply)) {
    if (key === "id" || key === "conversationId" || key === "text" || key === "direction" || key === "service" || key === "sender") {
      continue;
    }
    issues.push(issue(`${base}/replyTo/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
  }
  if (Object.hasOwn(reply, "service")) {
    if (!SERVICES.has(reply.service as Service)) {
      issues.push(issue(`${base}/replyTo/service`, "INVALID_VALUE", "reply quote service must be imessage or sms"));
    } else {
      parsed.service = reply.service as Service;
    }
  }
  if (Object.hasOwn(reply, "sender")) {
    if (typeof reply.sender !== "string") {
      issues.push(issue(`${base}/replyTo/sender`, "INVALID_TYPE", "reply quote sender must be a string"));
    } else {
      parsed.sender = reply.sender;
    }
  }
  return parsed;
}

function readReactions(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
): { present: boolean; targets: string[]; items: ParsedReaction[] } {
  if (!Object.hasOwn(value, "reactions")) return { present: false, targets: [], items: [] };
  const reactions = value.reactions;
  if (!Array.isArray(reactions)) {
    issues.push(issue(`${base}/reactions`, "INVALID_TYPE", "reactions must be an array"));
    return { present: false, targets: [], items: [] };
  }
  const targets: string[] = [];
  const items: ParsedReaction[] = [];
  reactions.forEach((reaction, index) => {
    const path = `${base}/reactions/${index}`;
    if (!isPlainObject(reaction)) {
      issues.push(issue(path, "INVALID_TYPE", "reaction must be an object"));
      return;
    }
    if (typeof reaction.type !== "string" || reaction.type.length === 0) {
      issues.push(issue(`${path}/type`, "INVALID_VALUE", "reaction type must be a non-empty string"));
    }
    if (Object.hasOwn(reaction, "byMe") && typeof reaction.byMe !== "boolean") {
      issues.push(issue(`${path}/byMe`, "INVALID_TYPE", "reaction byMe must be a boolean"));
    }
    if (Object.hasOwn(reaction, "emoji") && (typeof reaction.emoji !== "string" || reaction.emoji.length === 0)) {
      issues.push(issue(`${path}/emoji`, "INVALID_TYPE", "reaction emoji must be a non-empty string"));
    }
    if (Object.hasOwn(reaction, "id") && (typeof reaction.id !== "string" || reaction.id.length === 0)) {
      issues.push(issue(`${path}/id`, "INVALID_VALUE", "reaction id must be a non-empty string"));
    }
    const target = reaction.messageId ?? reaction.targetId;
    if (target !== undefined && (typeof target !== "string" || target.length === 0)) {
      issues.push(issue(`${path}/messageId`, "INVALID_REFERENCE", "reaction target must be a message id"));
    } else if (typeof target === "string") {
      targets.push(target);
    }
    for (const key of Object.keys(reaction)) {
      if (key === "id" || key === "type" || key === "byMe" || key === "emoji" || key === "messageId" || key === "targetId") continue;
      issues.push(issue(`${path}/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
    }
    if (typeof reaction.type === "string" && reaction.type.length > 0) {
      const parsed: ParsedReaction = { type: reaction.type };
      if (typeof reaction.id === "string" && reaction.id.length > 0) parsed.id = reaction.id;
      if (typeof reaction.byMe === "boolean") parsed.byMe = reaction.byMe;
      if (typeof reaction.emoji === "string" && reaction.emoji.length > 0) parsed.emoji = reaction.emoji;
      if (typeof target === "string" && target.length > 0) parsed.target = target;
      items.push(parsed);
    }
  });
  return { present: true, targets, items };
}

function readEdited(value: Record<string, unknown>, base: string, issues: ValidationIssue[]): boolean | undefined {
  if (!Object.hasOwn(value, "edited")) return undefined;
  if (typeof value.edited !== "boolean") {
    issues.push(issue(`${base}/edited`, "INVALID_TYPE", "edited must be a boolean"));
    return undefined;
  }
  return value.edited;
}

function readRemoved(value: Record<string, unknown>, base: string, issues: ValidationIssue[]): boolean | undefined {
  if (!Object.hasOwn(value, "removed")) return undefined;
  if (typeof value.removed !== "boolean") {
    issues.push(issue(`${base}/removed`, "INVALID_TYPE", "removed must be a boolean"));
    return undefined;
  }
  return value.removed;
}

function readReplyCount(value: Record<string, unknown>, base: string, issues: ValidationIssue[]): void {
  if (!Object.hasOwn(value, "replyCount")) return;
  issues.push(
    issue(
      `${base}/replyCount`,
      "INVALID_VALUE",
      "reply counts are recomputed by the runtime contract",
    ),
  );
}

function readPlatforms(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  flowPlatform: DemoPlatform | undefined,
): void {
  if (!Object.hasOwn(value, "platforms")) return;
  const declared = value.platforms;
  if (!Array.isArray(declared) || declared.some((entry) => entry !== "ios" && entry !== "macos")) {
    issues.push(issue(`${base}/platforms`, "INVALID_VALUE", "platforms must be an array of ios and macos"));
    return;
  }
  if (flowPlatform && (declared.length !== 1 || declared[0] !== flowPlatform)) {
    issues.push(
      issue(
        `${base}/platforms`,
        "PLATFORM_MISMATCH",
        `message targets ${declared.join(", ")} but the demo platform is ${flowPlatform}`,
      ),
    );
    return;
  }
  issues.push(
    issue(
      `${base}/platforms`,
      "UNKNOWN_FIELD",
      "platform targets are declared once on the demo, not on each message",
    ),
  );
}

function readOptionalMillis(
  value: Record<string, unknown>,
  key: "readAt" | "sentAt",
  path: string,
  issues: ValidationIssue[],
): number | "absent" | "invalid" {
  if (!Object.hasOwn(value, key)) return "absent";
  const stamp = value[key];
  if (typeof stamp !== "number" || !Number.isSafeInteger(stamp) || stamp < 0) {
    issues.push(issue(path, "INVALID_TIMESTAMP", `${key} must be an integer number of epoch milliseconds`));
    return "invalid";
  }
  return stamp;
}

function readEffect(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  kind: MessageKind | undefined,
  kindBlocked: boolean,
  direction: Direction | undefined,
): BubbleEffectName | undefined {
  if (!Object.hasOwn(value, "effect")) return undefined;
  if (typeof value.effect !== "string" || !EFFECTS.has(value.effect as BubbleEffectName)) {
    issues.push(
      issue(
        `${base}/effect`,
        "INVALID_VALUE",
        "effect must be slam, loud, gentle, or invisible-ink",
      ),
    );
    return undefined;
  }
  const effect = value.effect as BubbleEffectName;
  const effectiveKind = kind ?? "text";
  if (!kindBlocked && effectiveKind !== "text") {
    issues.push(
      issue(
        `${base}/effect`,
        "INVALID_ANIMATION",
        `native send effects apply to outgoing text, not ${JSON.stringify(effectiveKind)}`,
      ),
    );
    return undefined;
  }
  if (!kindBlocked && direction === "incoming" && effect !== undefined) {
    issues.push(
      issue(
        `${base}/effect`,
        "INVALID_ANIMATION",
        `${effect} conflicts with the receive arrival flight`,
      ),
    );
    return undefined;
  }
  if (effect !== "invisible-ink" && !(effect in bubbleEffectDurationMs)) return undefined;
  return effect;
}

function readLink(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  required: boolean,
): DemoMessage["link"] | "invalid" | undefined {
  if (!Object.hasOwn(value, "link")) {
    if (required) issues.push(issue(`${base}/link`, "MISSING_FIELD", "link messages require a link payload"));
    return undefined;
  }
  const link = value.link;
  if (!isPlainObject(link)) {
    issues.push(issue(`${base}/link`, "INVALID_TYPE", "link must be an object"));
    return "invalid";
  }
  let invalid = false;
  if (!Object.hasOwn(link, "url")) {
    issues.push(issue(`${base}/link/url`, "MISSING_FIELD", "link.url is required"));
    invalid = true;
  } else if (typeof link.url !== "string" || !isDisplayedHttpUrl(link.url)) {
    issues.push(issue(`${base}/link/url`, "INVALID_ASSET", "link destinations must be http or https URLs"));
    invalid = true;
  }
  if (Object.hasOwn(link, "title") && typeof link.title !== "string") {
    issues.push(issue(`${base}/link/title`, "INVALID_TYPE", "link.title must be a string"));
    invalid = true;
  }
  if (Object.hasOwn(link, "host") && typeof link.host !== "string") {
    issues.push(issue(`${base}/link/host`, "INVALID_TYPE", "link.host must be a string"));
    invalid = true;
  }
  if (Object.hasOwn(link, "image")) {
    if (typeof link.image !== "string" || !isDemoImageSrc(link.image)) {
      issues.push(issue(`${base}/link/image`, "INVALID_ASSET", "link images must be local paths inside the asset root"));
      invalid = true;
    }
  }
  for (const key of Object.keys(link)) {
    if (key === "url" || key === "title" || key === "host" || key === "image") continue;
    issues.push(issue(`${base}/link/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
    invalid = true;
  }
  if (invalid || typeof link.url !== "string") return "invalid";
  const copy: NonNullable<DemoMessage["link"]> = { url: link.url };
  if (typeof link.title === "string") copy.title = link.title;
  if (typeof link.host === "string") copy.host = link.host;
  if (typeof link.image === "string" && isDemoImageSrc(link.image)) copy.image = link.image;
  return copy;
}

function readAttachments(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  required: boolean,
): DemoMessage["attachments"] | "invalid" | undefined {
  if (!Object.hasOwn(value, "attachments")) {
    if (required) issues.push(issue(`${base}/attachments`, "MISSING_FIELD", "attachment messages require attachments"));
    return undefined;
  }
  if (!Array.isArray(value.attachments)) {
    issues.push(issue(`${base}/attachments`, "INVALID_TYPE", "attachments must be an array"));
    return "invalid";
  }
  if (required && value.attachments.length === 0) {
    issues.push(issue(`${base}/attachments`, "MISSING_FIELD", "attachment messages require at least one attachment"));
    return "invalid";
  }
  let invalid = false;
  const copies: NonNullable<DemoMessage["attachments"]> = [];
  value.attachments.forEach((item, index) => {
    const path = `${base}/attachments/${index}`;
    if (!isPlainObject(item)) {
      issues.push(issue(path, "INVALID_TYPE", "attachment must be an object"));
      invalid = true;
      return;
    }
    if (typeof item.name !== "string" || !isConfinedName(item.name)) {
      issues.push(issue(`${path}/name`, "INVALID_ASSET", "attachment names must stay inside the asset root"));
      invalid = true;
    }
    if (Object.hasOwn(item, "size") && typeof item.size !== "string") {
      issues.push(issue(`${path}/size`, "INVALID_TYPE", "attachment size must be a string"));
      invalid = true;
    }
    if (Object.hasOwn(item, "href") && (typeof item.href !== "string" || !isAttachmentHref(item.href))) {
      issues.push(issue(`${path}/href`, "INVALID_ASSET", "attachment href must be a local asset path or an https URL"));
      invalid = true;
    }
    for (const key of Object.keys(item)) {
      if (key === "name" || key === "size" || key === "href") continue;
      issues.push(issue(`${path}/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
      invalid = true;
    }
    if (typeof item.name === "string" && isConfinedName(item.name)) {
      const copy: NonNullable<DemoMessage["attachments"]>[number] = { name: item.name };
      if (typeof item.size === "string") copy.size = item.size;
      if (typeof item.href === "string" && isAttachmentHref(item.href)) copy.href = item.href;
      copies.push(copy);
    }
  });
  return invalid ? "invalid" : copies;
}

function readImages(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  required: boolean,
): DemoMessage["images"] | "invalid" | undefined {
  if (!Object.hasOwn(value, "images")) {
    if (required) issues.push(issue(`${base}/images`, "MISSING_FIELD", "image messages require images"));
    return undefined;
  }
  if (!Array.isArray(value.images)) {
    issues.push(issue(`${base}/images`, "INVALID_TYPE", "images must be an array"));
    return "invalid";
  }
  if (required && value.images.length === 0) {
    issues.push(issue(`${base}/images`, "MISSING_FIELD", "image messages require at least one image"));
    return "invalid";
  }
  let invalid = false;
  const copies: NonNullable<DemoMessage["images"]> = [];
  value.images.forEach((item, index) => {
    const path = `${base}/images/${index}`;
    if (!isPlainObject(item)) {
      issues.push(issue(path, "INVALID_TYPE", "image must be an object"));
      invalid = true;
      return;
    }
    if (typeof item.src !== "string" || !isDemoImageSrc(item.src)) {
      issues.push(issue(`${path}/src`, "INVALID_ASSET", "images must be local paths inside the asset root"));
      invalid = true;
    }
    if (typeof item.alt !== "string") {
      issues.push(issue(`${path}/alt`, "MISSING_FIELD", "image alt must be a string"));
      invalid = true;
    }
    for (const dimension of ["width", "height"] as const) {
      if (!Object.hasOwn(item, dimension)) continue;
      const size = item[dimension];
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
        issues.push(issue(`${path}/${dimension}`, "INVALID_ASSET", `${dimension} must be a positive integer`));
        invalid = true;
      }
    }
    for (const key of Object.keys(item)) {
      if (key === "src" || key === "alt" || key === "width" || key === "height") continue;
      issues.push(issue(`${path}/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
      invalid = true;
    }
    if (typeof item.src === "string" && isDemoImageSrc(item.src) && typeof item.alt === "string") {
      const copy: NonNullable<DemoMessage["images"]>[number] = { src: item.src, alt: item.alt };
      if (typeof item.width === "number" && Number.isSafeInteger(item.width) && item.width > 0) copy.width = item.width;
      if (typeof item.height === "number" && Number.isSafeInteger(item.height) && item.height > 0) copy.height = item.height;
      copies.push(copy);
    }
  });
  return invalid ? "invalid" : copies;
}

function readAudio(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  required: boolean,
): DemoMessage["audio"] | "invalid" | undefined {
  if (!Object.hasOwn(value, "audio")) {
    if (required) issues.push(issue(`${base}/audio`, "MISSING_FIELD", "audio messages require an audio payload"));
    return undefined;
  }
  const audio = value.audio;
  if (!isPlainObject(audio)) {
    issues.push(issue(`${base}/audio`, "INVALID_TYPE", "audio must be an object"));
    return "invalid";
  }
  let invalid = false;
  if (typeof audio.duration !== "number" || !Number.isFinite(audio.duration) || audio.duration < 0) {
    issues.push(issue(`${base}/audio/duration`, "INVALID_VALUE", "audio duration must be a nonnegative number of seconds"));
    invalid = true;
  }
  let peaks: number[] | undefined;
  if (Object.hasOwn(audio, "peaks")) {
    if (!Array.isArray(audio.peaks) || audio.peaks.some((peak) => typeof peak !== "number" || !Number.isFinite(peak) || peak < 0 || peak > 1)) {
      issues.push(issue(`${base}/audio/peaks`, "INVALID_ASSET", "audio peaks must be numbers from 0 to 1"));
      invalid = true;
    } else {
      peaks = [...audio.peaks];
    }
  }
  for (const key of Object.keys(audio)) {
    if (key === "duration" || key === "peaks" || key === "src") continue;
    issues.push(issue(`${base}/audio/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
    invalid = true;
  }
  if (invalid || typeof audio.duration !== "number") return "invalid";
  const copy: NonNullable<DemoMessage["audio"]> = { duration: audio.duration };
  if (peaks) copy.peaks = peaks;
  return copy;
}

function readAppCard(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  required: boolean,
): AppCardPayload | "invalid" | undefined {
  if (!Object.hasOwn(value, "appCard")) {
    if (required) issues.push(issue(`${base}/appCard`, "MISSING_FIELD", "app-card messages require an appCard payload"));
    return undefined;
  }
  const card = value.appCard;
  if (!isPlainObject(card)) {
    issues.push(issue(`${base}/appCard`, "INVALID_TYPE", "appCard must be an object"));
    return "invalid";
  }
  if (card.app === 'sheet') {
    const parsed = appCardPayloadSchema.safeParse(card);
    if (!parsed.success) { for (const error of parsed.error.issues) issues.push(issue(`${base}/appCard/${error.path.join('/')}`, 'INVALID_VALUE', error.message)); return 'invalid'; }
    return parsed.data;
  }
  let invalid = false;
  if (!Object.hasOwn(card, "url")) {
    issues.push(issue(`${base}/appCard/url`, "MISSING_FIELD", "appCard.url is required"));
    invalid = true;
  } else if (typeof card.url !== "string" || !(isAppCardUrl(card.url) || (card.app === "miniapp" && /^\/demo-apps\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.html$/.test(card.url)))) {
    issues.push(issue(`${base}/appCard/url`, "INVALID_VALUE", "appCard.url must be an absolute http or https URL without credentials"));
    invalid = true;
  } else if (card.app === "checkout" && APP_CARD_RENDERER_PARAMS.some((name) => new URL(card.url as string).searchParams.has(name))) {
    issues.push(
      issue(`${base}/appCard/url`, "INVALID_VALUE", "the renderer appends presentation and parentOrigin itself; remove them from appCard.url"),
    );
    invalid = true;
  }
  if (card.live !== true) {
    issues.push(issue(`${base}/appCard/live`, "INVALID_VALUE", "only live app cards are supported: set appCard.live to true"));
    invalid = true;
  }
  if (card.app !== "checkout" && card.app !== "miniapp") {
    issues.push(issue(`${base}/appCard/app`, "UNSUPPORTED_COMPONENT", 'supported app cards are Photon checkout (app "checkout") and mini apps (app "miniapp")'));
    invalid = true;
  }
  let layout: AppCardPayload["layout"];
  if (card.app === "miniapp") {
    const parsed = miniAppLayoutSchema.safeParse(card.layout);
    if (!parsed.success) {
      for (const error of parsed.error.issues) issues.push(issue(`${base}/appCard/layout${error.path.length ? "/" + error.path.join("/") : ""}`, "INVALID_VALUE", error.message));
      invalid = true;
    } else layout = parsed.data;
  } else if (Object.hasOwn(card, "layout")) {
    issues.push(issue(`${base}/appCard/layout`, "INVALID_VALUE", "layout belongs to a miniapp card, not checkout"));
    invalid = true;
  }
  if (
    Object.hasOwn(card, "height") &&
    (typeof card.height !== "number" || !Number.isSafeInteger(card.height) || card.height < APP_CARD_MIN_HEIGHT || card.height > APP_CARD_MAX_HEIGHT)
  ) {
    issues.push(
      issue(`${base}/appCard/height`, "INVALID_VALUE", `appCard.height must be an integer from ${APP_CARD_MIN_HEIGHT} to ${APP_CARD_MAX_HEIGHT} points`),
    );
    invalid = true;
  }
  for (const key of Object.keys(card)) {
    if (key === "url" || key === "live" || key === "app" || key === "height" || key === "layout") continue;
    issues.push(issue(`${base}/appCard/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
    invalid = true;
  }
  if (invalid || typeof card.url !== "string") return "invalid";
  const copy: AppCardPayload = { url: card.url, live: true, app: card.app as AppCardPayload["app"] };
  if (layout) copy.layout = layout;
  if (typeof card.height === "number") copy.height = card.height;
  return copy;
}

function rejectAppCardDecorations(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  flowPlatform: DemoPlatform | undefined,
): void {
  if (flowPlatform === "macos") {
    issues.push(issue(`${base}/kind`, "PLATFORM_MISMATCH", "app-card is an iOS surface; the macOS renderer does not host live app cards"));
  }
  if (value.service === "sms") {
    issues.push(issue(`${base}/service`, "INVALID_VALUE", "a live app card is an iMessage surface, not SMS"));
  }
  for (const field of APP_CARD_EXCLUDED_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    issues.push(issue(`${base}/${field}`, "INVALID_VALUE", `${field} is not supported on a live app card`));
  }
}

function isAppCardUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

function readContact(
  value: unknown,
  present: boolean,
  issues: ValidationIssue[],
): DemoFlow["contact"] | undefined {
  if (!present) {
    issues.push(issue(pointer(["contact"]), "MISSING_FIELD", "missing contact"));
    return undefined;
  }
  if (!isPlainObject(value)) {
    issues.push(issue(pointer(["contact"]), "INVALID_TYPE", "contact must be an object"));
    return undefined;
  }
  const name = readBoundedString(value, "name", pointer(["contact", "name"]), issues, false);
  let initials: string | undefined;
  if (Object.hasOwn(value, "initials")) {
    if (typeof value.initials !== "string") {
      issues.push(issue(pointer(["contact", "initials"]), "INVALID_TYPE", "initials must be a string"));
    } else {
      initials = value.initials;
    }
  }
  let photo: string | undefined;
  let silhouette: boolean | undefined;
  if (Object.hasOwn(value, "photo")) {
    if (typeof value.photo !== "string" || value.photo.length === 0) {
      issues.push(issue(pointer(["contact", "photo"]), "INVALID_ASSET", "contact photo must be a non-empty asset path"));
    } else photo = value.photo;
  }
  if (Object.hasOwn(value, "silhouette")) {
    if (typeof value.silhouette !== "boolean") {
      issues.push(issue(pointer(["contact", "silhouette"]), "INVALID_TYPE", "silhouette must be a boolean"));
    } else silhouette = value.silhouette;
  }
  for (const key of Object.keys(value)) {
    if (key === "name" || key === "initials" || key === "photo" || key === "silhouette") continue;
    issues.push(issue(pointer(["contact", key]), "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
  }
  if (name === undefined) return undefined;
  const contact: DemoFlow["contact"] = { name };
  if (initials !== undefined) contact.initials = initials;
  if (photo !== undefined) contact.photo = photo;
  if (silhouette !== undefined) contact.silhouette = silhouette;
  return contact;
}

function readDraft(input: Record<string, unknown>, issues: ValidationIssue[]): string | undefined {
  if (!Object.hasOwn(input, "draft")) {
    issues.push(issue(pointer(["draft"]), "MISSING_FIELD", "missing draft"));
    return undefined;
  }
  if (typeof input.draft !== "string") {
    issues.push(issue(pointer(["draft"]), "INVALID_TYPE", "draft must be a string"));
    return undefined;
  }
  return input.draft;
}

function readBoundedString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  allowEmpty: boolean,
): string | undefined {
  if (!Object.hasOwn(value, key)) {
    issues.push(issue(path, "MISSING_FIELD", `missing ${key}`));
    return undefined;
  }
  if (typeof value[key] !== "string" || (!allowEmpty && (value[key] as string).length === 0)) {
    issues.push(issue(path, "INVALID_VALUE", `${key} must be a non-empty string`));
    return undefined;
  }
  return value[key] as string;
}

function readText(value: Record<string, unknown>, path: string, issues: ValidationIssue[]): string | undefined {
  if (!Object.hasOwn(value, "text")) {
    issues.push(issue(path, "MISSING_FIELD", "missing text"));
    return undefined;
  }
  if (typeof value.text !== "string") {
    issues.push(issue(path, "INVALID_TYPE", "text must be a string"));
    return undefined;
  }
  return value.text;
}

function readBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  required: boolean,
): boolean | undefined {
  if (!Object.hasOwn(value, key)) {
    if (required) issues.push(issue(path, "MISSING_FIELD", `missing ${key}`));
    return undefined;
  }
  if (typeof value[key] !== "boolean") {
    issues.push(issue(path, "INVALID_TYPE", `${key} must be a boolean`));
    return undefined;
  }
  return value[key] as boolean;
}

function readMillis(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  required: boolean,
): number | undefined {
  if (!Object.hasOwn(value, key)) {
    if (required) issues.push(issue(path, "MISSING_FIELD", `missing ${key}`));
    return undefined;
  }
  const stamp = value[key];
  if (typeof stamp !== "number" || !Number.isSafeInteger(stamp)) {
    issues.push(issue(path, "INVALID_TIMESTAMP", `${key} must be an integer number of milliseconds`));
    return undefined;
  }
  if (stamp < 0) {
    issues.push(issue(path, "INVALID_TIMESTAMP", `${key} must be zero or greater`));
    return undefined;
  }
  return stamp;
}

function readEnum<T extends string>(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  allowed: Set<T>,
): T | undefined {
  if (!Object.hasOwn(value, key)) {
    issues.push(issue(path, "MISSING_FIELD", `missing ${key}`));
    return undefined;
  }
  if (typeof value[key] !== "string" || !allowed.has(value[key] as T)) {
    issues.push(issue(path, "INVALID_VALUE", `${key} must be ${[...allowed].join(" or ")}`));
    return undefined;
  }
  return value[key] as T;
}

function readOptionalEnum<T extends string>(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  allowed: Set<T>,
): T | undefined {
  if (!Object.hasOwn(value, key)) return undefined;
  if (typeof value[key] !== "string" || !allowed.has(value[key] as T)) {
    issues.push(issue(path, "INVALID_VALUE", `${key} must be ${[...allowed].join(" or ")}`));
    return undefined;
  }
  return value[key] as T;
}

function isDisplayedHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAttachmentHref(value: string): boolean {
  return isHttpsUrl(value) || isDemoImageSrc(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isDemoImageSrc(value: string): boolean {
  if (value.startsWith("/demo-assets/")) return isConfinedRelativePath(value.slice("/demo-assets/".length));
  return isConfinedRelativePath(value);
}

function isConfinedRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "..");
}

function isConfinedName(value: string): boolean {
  return isConfinedRelativePath(value) && !value.includes("/");
}

function escapeSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

const EVENT_TYPES = new Set([
  "sheet-app",
  "message",
  "typing",
  "draft",
  "status",
  "reaction",
  "edit",
  "remove",
  "reveal",
  "screen",
  "select-conversation",
  "scroll",
  "window-active",
  "overlay",
  "screen-effect",
  "audio-control",
  "time-reveal",
  "notice",
  "poll-option",
  "poll-vote",
  "sticker",
]);

const EVENT_FIELDS: Record<string, string[]> = {
  "sheet-app": ["type", "atMs", "sourceIndex", "messageId", "action"],
  message: ["type", "atMs", "sourceIndex", "conversationId", "message"],
  typing: ["type", "atMs", "sourceIndex", "conversationId", "typing"],
  draft: ["type", "atMs", "sourceIndex", "conversationId", "value"],
  status: ["type", "atMs", "sourceIndex", "messageId", "status"],
  reaction: ["type", "atMs", "sourceIndex", "messageId", "reactionId", "reaction"],
  edit: ["type", "atMs", "sourceIndex", "messageId", "text"],
  remove: ["type", "atMs", "sourceIndex", "messageId"],
  reveal: ["type", "atMs", "sourceIndex", "messageId", "revealed"],
  screen: ["type", "atMs", "sourceIndex", "screen"],
  "select-conversation": ["type", "atMs", "sourceIndex", "conversationId", "contact"],
  scroll: ["type", "atMs", "sourceIndex", "conversationId", "offset"],
  "window-active": ["type", "atMs", "sourceIndex", "active"],
  overlay: ["type", "atMs", "sourceIndex", "overlay"],
  "screen-effect": ["type", "atMs", "sourceIndex", "effect", "messageId"],
  "audio-control": ["type", "atMs", "sourceIndex", "messageId", "position", "playing", "seeking"],
  "time-reveal": ["type", "atMs", "sourceIndex", "progress"],
  notice: ["type", "atMs", "sourceIndex", "notice"],
  "poll-option": ["type", "atMs", "sourceIndex", "conversationId", "messageId", "optionId", "text"],
  "poll-vote": ["type", "atMs", "sourceIndex", "conversationId", "messageId", "participantId", "voterId", "optionId", "voted"],
  sticker: ["type", "atMs", "sourceIndex", "conversationId", "messageId", "sticker"],
};

type LiveMessage = {
  id: string;
  atMs: number;
  direction?: Direction;
  kind: MessageKind;
  effect?: BubbleEffectName;
  imageCount: number;
  audioDuration?: number;
  sheetApp?: boolean;
  pollOptionIds?: Set<string>;
  pollVoterIds?: Set<string>;
};

function readTimeline(
  input: Record<string, unknown>,
  issues: ValidationIssue[],
  platform: DemoPlatform | undefined,
): CompiledEvent[] | undefined {
  if (!Object.hasOwn(input, "events")) return [];
  if (!Array.isArray(input.events)) {
    issues.push(issue(pointer(["events"]), "INVALID_TYPE", "events must be an array"));
    return undefined;
  }
  const live = liveMessages(input.messages);
  const removed = new Set<string>();
  for (const message of messageRecords(input.messages)) {
    if (message.removed === true && typeof message.id === "string") removed.add(message.id);
  }
  const seen = new Set(live.keys());
  let previousAt: number | undefined;
  const baseline = typeof input.startAtMs === "number" ? input.startAtMs : firstMessageAt(input.messages);
  const events: CompiledEvent[] = [];
  let valid = true;
  input.events.forEach((value, index) => {
    const base = pointer(["events", index]);
    if (!isPlainObject(value) || typeof value.type !== "string" || !EVENT_TYPES.has(value.type)) {
      valid = false;
      issues.push(issue(`${base}/type`, "INVALID_VALUE", "unknown timeline event"));
      return;
    }
    const before = issues.length;
    const atMs = readMillis(value, "atMs", `${base}/atMs`, issues, true);
    if (atMs !== undefined && previousAt !== undefined && atMs < previousAt) {
      issues.push(issue(`${base}/atMs`, "INVALID_TIMESTAMP", "timeline events must be in chronological order"));
    }
    if (atMs !== undefined && baseline !== undefined && atMs < baseline) {
      issues.push(issue(`${base}/atMs`, "INVALID_TIMESTAMP", "timeline events cannot precede startAtMs (or the first message when startAtMs is omitted)"));
    }
    if (atMs !== undefined) previousAt = atMs;
    rejectEventFields(value, value.type, base, issues);
    const parsed = parseTimelineEvent(value, base, issues, platform, live, removed, seen, atMs);
    if (!parsed && issues.length === before) {
      issues.push(issue(base, "INVALID_VALUE", "timeline event is incomplete"));
    }
    if (issues.length !== before || !parsed) valid = false;
    else events.push(parsed);
  });
  return valid ? events : undefined;
}

function messageRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject);
}

function firstMessageAt(value: unknown): number | undefined {
  const first = messageRecords(value)[0];
  return first && typeof first.atMs === "number" ? first.atMs : undefined;
}

function liveMessages(value: unknown): Map<string, LiveMessage> {
  const live = new Map<string, LiveMessage>();
  messageRecords(value).forEach((message) => {
    if (typeof message.id !== "string" || message.id.length === 0 || live.has(message.id)) return;
    if (typeof message.atMs !== "number") return;
    const kind = typeof message.kind === "string" && MESSAGE_KINDS.has(message.kind as MessageKind) ? (message.kind as MessageKind) : "text";
    const entry: LiveMessage = { id: message.id, atMs: message.atMs, kind, imageCount: Array.isArray(message.images) ? message.images.length : 0 };
    entry.sheetApp = isPlainObject(message.appCard) && message.appCard.app === "sheet";
    if (message.direction === "incoming" || message.direction === "outgoing") entry.direction = message.direction;
    if (typeof message.effect === "string" && EFFECTS.has(message.effect as BubbleEffectName)) entry.effect = message.effect as BubbleEffectName;
    if (isPlainObject(message.audio) && typeof message.audio.duration === "number") entry.audioDuration = message.audio.duration;
    if (kind === "poll" && isPlainObject(message.poll)) {
      const options = Array.isArray(message.poll.options) ? message.poll.options : [];
      entry.pollOptionIds = new Set(options.flatMap((option) => (isPlainObject(option) && typeof option.id === "string" ? [option.id] : [])));
      if (Array.isArray(message.poll.voters)) {
        entry.pollVoterIds = new Set(message.poll.voters.flatMap((voter) => (isPlainObject(voter) && typeof voter.id === "string" ? [voter.id] : [])));
      }
    }
    live.set(message.id, entry);
  });
  return live;
}

function rejectEventFields(value: Record<string, unknown>, type: string, base: string, issues: ValidationIssue[]): void {
  const allowed = new Set(EVENT_FIELDS[type] ?? []);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    issues.push(issue(`${base}/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
  }
}

function liveMessage(live: Map<string, LiveMessage>, removed: Set<string>, id: string, atMs: number | undefined): LiveMessage | undefined {
  if (atMs === undefined) return undefined;
  const message = live.get(id);
  if (!message || message.atMs > atMs || removed.has(id)) return undefined;
  return message;
}

function requireLive(
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  id: unknown,
  atMs: number | undefined,
  path: string,
  issues: ValidationIssue[],
  label: string,
): LiveMessage | undefined {
  if (typeof id !== "string" || id.length === 0) {
    issues.push(issue(path, "INVALID_REFERENCE", `${label} target must be a message id`));
    return undefined;
  }
  const message = liveMessage(live, removed, id, atMs);
  if (!message) {
    issues.push(issue(path, "INVALID_REFERENCE", `${label} target ${JSON.stringify(id)} is not a live message at this time`));
    return undefined;
  }
  return message;
}

function parseTimelineEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  platform: DemoPlatform | undefined,
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  seen: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  switch (value.type) {
    case "sheet-app": {
      const target = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, 'sheet app');
      if (platform !== 'ios' || !target?.sheetApp) { issues.push(issue(base, 'INVALID_REFERENCE', 'sheet-app events require a live iOS custom sheet card')); return undefined; }
      if (!['open', 'compact', 'expand', 'close'].includes(String(value.action))) { issues.push(issue(`${base}/action`, 'INVALID_VALUE', 'Invalid sheet action')); return undefined; }
      return atMs === undefined ? undefined : { type: 'sheet-app', atMs, messageId: target.id, action: value.action as 'open' | 'compact' | 'expand' | 'close' };
    }
    case "message":
      return parseMessageEvent(value, base, issues, live, seen, atMs);
    case "typing":
      return typeof value.typing === "boolean" && atMs !== undefined ? { type: "typing", atMs, typing: value.typing } : undefined;
    case "draft":
      return typeof value.value === "string" && atMs !== undefined ? { type: "draft", atMs, value: value.value } : undefined;
    case "status": {
      const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "status");
      if (message?.kind === "app-card") {
        issues.push(issue(`${base}/messageId`, "INVALID_VALUE", "status is not supported on a live app card"));
        return undefined;
      }
      if (!message || atMs === undefined || typeof value.messageId !== "string" || !STATUSES.has(value.status as MessageStatus)) {
        if (value.status !== undefined && !STATUSES.has(value.status as MessageStatus)) {
          issues.push(issue(`${base}/status`, "INVALID_VALUE", "status must be sending, sent, delivered, read, or failed"));
        }
        return undefined;
      }
      return { type: "status", atMs, messageId: value.messageId, status: value.status as MessageStatus };
    }
    case "reaction":
      return parseReactionEvent(value, base, issues, live, removed, atMs);
    case "edit": {
      const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "edit");
      if (!message || atMs === undefined || typeof value.messageId !== "string" || typeof value.text !== "string") return undefined;
      if (message.direction !== "outgoing" || message.kind !== "text") {
        issues.push(issue(`${base}/messageId`, "INVALID_VALUE", "edit target must be outgoing text"));
        return undefined;
      }
      return { type: "edit", atMs, messageId: value.messageId, text: value.text };
    }
    case "remove": {
      const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "remove");
      if (!message || atMs === undefined || typeof value.messageId !== "string") return undefined;
      removed.add(value.messageId);
      return { type: "remove", atMs, messageId: value.messageId };
    }
    case "reveal": {
      const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "reveal");
      if (!message || atMs === undefined || typeof value.messageId !== "string" || typeof value.revealed !== "boolean") return undefined;
      if (message.effect !== "invisible-ink") {
        issues.push(issue(`${base}/messageId`, "INVALID_VALUE", "reveal target must be an invisible-ink message"));
        return undefined;
      }
      return { type: "reveal", atMs, messageId: value.messageId, revealed: value.revealed };
    }
    case "screen": {
      if (atMs === undefined || !SCREENS.has(value.screen as IosScreenName)) return undefined;
      const screen = value.screen as IosScreenName;
      if (platform === "macos" && IOS_ONLY_SCREENS.has(screen)) {
        issues.push(issue(`${base}/screen`, "PLATFORM_MISMATCH", `${screen} is an iOS shell screen and is not a macOS target`));
        return undefined;
      }
      return { type: "screen", atMs, screen };
    }
    case "select-conversation":
      return typeof value.conversationId === "string" && value.conversationId.length > 0 && atMs !== undefined
        ? { type: "select-conversation", atMs, conversationId: value.conversationId }
        : undefined;
    case "scroll":
      return typeof value.offset === "number" && Number.isFinite(value.offset) && atMs !== undefined
        ? { type: "scroll", atMs, offset: value.offset }
        : undefined;
    case "window-active":
      return typeof value.active === "boolean" && atMs !== undefined ? { type: "window-active", atMs, active: value.active } : undefined;
    case "overlay":
      return parseOverlayEvent(value, base, issues, platform, live, removed, atMs);
    case "screen-effect": {
      if (atMs === undefined || !SCREEN_EFFECTS.has(value.effect as ScreenEffectName)) {
        if (value.effect !== undefined && !SCREEN_EFFECTS.has(value.effect as ScreenEffectName)) {
          issues.push(issue(`${base}/effect`, "INVALID_VALUE", "screen effect must be a pinned full-screen effect"));
        }
        return undefined;
      }
      if (value.messageId !== undefined) requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "screen-effect");
      return { type: "screen-effect", atMs, effect: value.effect as ScreenEffectName, ...(typeof value.messageId === "string" ? { messageId: value.messageId } : {}) };
    }
    case "audio-control":
      return parseAudioEvent(value, base, issues, live, removed, atMs);
    case "time-reveal": {
      if (platform === "macos") {
        issues.push(issue(base, "PLATFORM_MISMATCH", "swipe-to-reveal timestamps are an iOS surface"));
        return undefined;
      }
      if (atMs === undefined || typeof value.progress !== "number" || value.progress < 0 || value.progress > 1) {
        issues.push(issue(`${base}/progress`, "INVALID_VALUE", "time reveal progress must be a number from 0 to 1"));
        return undefined;
      }
      return { type: "time-reveal", atMs, progress: value.progress };
    }
    case "notice":
      return parseNoticeEvent(value, base, issues, live, removed, atMs);
    case "poll-option":
      return parsePollOptionEvent(value, base, issues, platform, live, removed, atMs);
    case "poll-vote":
      return parsePollVoteEvent(value, base, issues, platform, live, removed, atMs);
    case "sticker":
      return parseStickerEvent(value, base, issues, platform, live, removed, atMs);
    default:
      if (typeof value.type === "string") {
        issues.push(issue(`${base}/type`, "INVALID_VALUE", `unknown event ${JSON.stringify(value.type)}`));
      }
      return undefined;
  }
}

function parseMessageEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  live: Map<string, LiveMessage>,
  seen: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  if (!isPlainObject(value.message) || atMs === undefined) {
    issues.push(issue(`${base}/message`, "INVALID_TYPE", "message events require a message"));
    return undefined;
  }
  const id = value.message.id;
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (seen.has(id)) {
    issues.push(issue(`${base}/message/id`, "DUPLICATE_ID", `duplicate message id ${JSON.stringify(id)}`));
    return undefined;
  }
  if (value.message.kind === "app-card") {
    issues.push(issue(`${base}/message/kind`, "INVALID_VALUE", "author app cards in messages, where their appCard payload is validated"));
    return undefined;
  }
  if (typeof value.message.text !== "string" || (value.message.direction !== "incoming" && value.message.direction !== "outgoing")) return undefined;
  seen.add(id);
  const kind = typeof value.message.kind === "string" && MESSAGE_KINDS.has(value.message.kind as MessageKind) ? (value.message.kind as MessageKind) : "text";
  live.set(id, { id, atMs, kind, direction: value.message.direction, imageCount: Array.isArray(value.message.images) ? value.message.images.length : 0 });
  const message: DemoMessage = { id, text: value.message.text, direction: value.message.direction, atMs };
  if (kind !== "text" || value.message.kind !== undefined) message.kind = kind;
  return { type: "message", atMs, message };
}

function parseReactionEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "reaction");
  if (message?.kind === "app-card") {
    issues.push(issue(`${base}/messageId`, "INVALID_VALUE", "reactions are not supported on a live app card"));
    return undefined;
  }
  if (!message || atMs === undefined || typeof value.messageId !== "string" || typeof value.reactionId !== "string" || value.reactionId.length === 0) {
    return undefined;
  }
  if (value.reaction === null) return { type: "reaction", atMs, messageId: value.messageId, reactionId: value.reactionId, reaction: null };
  if (!isPlainObject(value.reaction) || typeof value.reaction.type !== "string" || value.reaction.type.length === 0) {
    issues.push(issue(`${base}/reaction`, "INVALID_TYPE", "reaction must be an object or null"));
    return undefined;
  }
  for (const key of Object.keys(value.reaction)) {
    if (key === "type" || key === "byMe" || key === "emoji") continue;
    issues.push(issue(`${base}/reaction/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
  }
  const reaction: { type: string; byMe?: boolean; emoji?: string } = { type: value.reaction.type };
  if (typeof value.reaction.byMe === "boolean") reaction.byMe = value.reaction.byMe;
  if (typeof value.reaction.emoji === "string") reaction.emoji = value.reaction.emoji;
  return { type: "reaction", atMs, messageId: value.messageId, reactionId: value.reactionId, reaction };
}

const CLASSIC_TAPBACKS = new Set(["love", "like", "dislike", "laugh", "emphasize", "question"]);

function parsePickerSelection(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): PickerSelection | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isPlainObject(value)) {
    issues.push(issue(path, "INVALID_TYPE", "long-press selected must be a classic tapback, a custom emoji, or null"));
    return "invalid";
  }
  for (const key of Object.keys(value)) {
    if (key === "type" || key === "emoji") continue;
    issues.push(issue(`${path}/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
  }
  const hasType = Object.hasOwn(value, "type");
  const hasEmoji = Object.hasOwn(value, "emoji");
  if (hasType && hasEmoji) {
    issues.push(issue(path, "INVALID_VALUE", "long-press selected is either a classic type or a custom emoji"));
    return "invalid";
  }
  if (hasType) {
    if (typeof value.type !== "string" || !CLASSIC_TAPBACKS.has(value.type)) {
      issues.push(issue(`${path}/type`, "INVALID_VALUE", "long-press selected type must be a classic tapback"));
      return "invalid";
    }
    return { type: value.type as PickerSelection extends { type: infer Type } ? Type : never };
  }
  if (typeof value.emoji !== "string" || value.emoji.length === 0) {
    issues.push(issue(`${path}/emoji`, "INVALID_VALUE", "long-press selected emoji must be a non-empty string"));
    return "invalid";
  }
  return { emoji: value.emoji };
}

function parseOverlayEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  platform: DemoPlatform | undefined,
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  const overlay = value.overlay;
  if (!isPlainObject(overlay) || typeof overlay.kind !== "string" || atMs === undefined) {
    issues.push(issue(`${base}/overlay`, "INVALID_TYPE", "overlay must be an object"));
    return undefined;
  }
  if (platform === "macos" && IOS_ONLY_OVERLAYS.has(overlay.kind as OverlayState["kind"])) {
    issues.push(issue(`${base}/overlay/kind`, "PLATFORM_MISMATCH", `${overlay.kind} is an iOS overlay`));
    return undefined;
  }
  const target = overlay.kind === "thread" ? overlay.rootId : overlay.kind === "long-press" || overlay.kind === "context-menu" ? overlay.messageId : undefined;
  if (typeof target === "string" && live.get(target)?.kind === "app-card") {
    const field = overlay.kind === "thread" ? "rootId" : "messageId";
    issues.push(issue(`${base}/overlay/${field}`, "INVALID_VALUE", `${overlay.kind} cannot target a live app card`));
    return undefined;
  }
  if (overlay.kind === "selection" && [...live.values()].some((message) => message.kind === "app-card")) {
    issues.push(issue(`${base}/overlay/kind`, "INVALID_VALUE", "select mode re-creates every thread row and would reload a live app card"));
    return undefined;
  }
  switch (overlay.kind) {
    case "closed":
      return { type: "overlay", atMs, overlay: { kind: "closed" } };
    case "thread":
      if (!requireLive(live, removed, overlay.rootId, atMs, `${base}/overlay/rootId`, issues, "thread")) return undefined;
      return { type: "overlay", atMs, overlay: { kind: "thread", rootId: String(overlay.rootId) } };
    case "long-press": {
      if (!requireLive(live, removed, overlay.messageId, atMs, `${base}/overlay/messageId`, issues, "long-press")) return undefined;
      for (const key of Object.keys(overlay)) {
        if (key === "kind" || key === "messageId" || key === "selected") continue;
        issues.push(issue(`${base}/overlay/${escapeSegment(key)}`, "UNKNOWN_FIELD", `unknown field ${JSON.stringify(key)}`));
      }
      const selected = parsePickerSelection(overlay.selected, `${base}/overlay/selected`, issues);
      if (selected === "invalid") return undefined;
      const next: Extract<OverlayState, { kind: "long-press" }> = { kind: "long-press", messageId: String(overlay.messageId) };
      if (selected !== undefined) next.selected = selected;
      return { type: "overlay", atMs, overlay: next };
    }
    case "context-menu":
      if (!requireLive(live, removed, overlay.messageId, atMs, `${base}/overlay/messageId`, issues, "context-menu")) return undefined;
      if (typeof overlay.x !== "number" || typeof overlay.y !== "number") return undefined;
      return { type: "overlay", atMs, overlay: { kind: "context-menu", messageId: String(overlay.messageId), x: overlay.x, y: overlay.y } };
    case "plus-menu":
      return { type: "overlay", atMs, overlay: { kind: "plus-menu" } };
    case "effects-picker": {
      if (overlay.tab !== "bubble" && overlay.tab !== "screen") {
        issues.push(issue(`${base}/overlay/tab`, "INVALID_VALUE", "effects picker tab must be bubble or screen"));
        return undefined;
      }
      if (typeof overlay.draft !== "string") return undefined;
      const effect = typeof overlay.effect === "string" ? overlay.effect : undefined;
      if (effect !== undefined) {
        const allowed = overlay.tab === "bubble" ? EFFECTS : SCREEN_EFFECTS;
        if (!allowed.has(effect as never)) {
          issues.push(issue(`${base}/overlay/effect`, "INVALID_VALUE", "selected effect does not belong to the open picker tab"));
          return undefined;
        }
      }
      return { type: "overlay", atMs, overlay: { kind: "effects-picker", tab: overlay.tab, draft: overlay.draft, ...(effect ? { effect } : {}) } };
    }
    case "image-viewer": {
      const message = requireLive(live, removed, overlay.messageId, atMs, `${base}/overlay/messageId`, issues, "image-viewer");
      if (!message) return undefined;
      if (message.imageCount < 1) {
        issues.push(issue(`${base}/overlay/messageId`, "INVALID_VALUE", "image viewer target must contain images"));
        return undefined;
      }
      if (typeof overlay.index !== "number" || !Number.isSafeInteger(overlay.index) || overlay.index < 0 || overlay.index >= message.imageCount) {
        issues.push(issue(`${base}/overlay/index`, "INVALID_VALUE", "image viewer index must point at an image on the target message"));
        return undefined;
      }
      const viewer: Extract<OverlayState, { kind: "image-viewer" }> = { kind: "image-viewer", messageId: message.id, index: overlay.index };
      if (typeof overlay.zoom === "number" && overlay.zoom > 0) viewer.zoom = overlay.zoom;
      if (typeof overlay.chrome === "boolean") viewer.chrome = overlay.chrome;
      if (typeof overlay.dismiss === "number") viewer.dismiss = overlay.dismiss;
      return { type: "overlay", atMs, overlay: viewer };
    }
    case "details":
      return { type: "overlay", atMs, overlay: { kind: "details" } };
    case "photo-picker": {
      const selectedIds = Array.isArray(overlay.selectedIds) ? overlay.selectedIds.filter((id): id is string => typeof id === "string" && id.length > 0) : undefined;
      return {
        type: "overlay",
        atMs,
        overlay: {
          kind: "photo-picker",
          ...(typeof overlay.selectedId === "string" ? { selectedId: overlay.selectedId } : {}),
          ...(selectedIds ? { selectedIds } : {}),
          ...(overlay.detent === "collapsed" || overlay.detent === "expanded" ? { detent: overlay.detent } : {}),
        },
      };
    }
    case "search":
      return { type: "overlay", atMs, overlay: { kind: "search", query: typeof overlay.query === "string" ? overlay.query : "" } };
    case "recorder":
      if (overlay.state !== "recording" && overlay.state !== "stopped" && overlay.state !== "playing") {
        issues.push(issue(`${base}/overlay/state`, "INVALID_VALUE", "recorder state must be recording, stopped, or playing"));
        return undefined;
      }
      return {
        type: "overlay",
        atMs,
        overlay: {
          kind: "recorder",
          state: overlay.state,
          ...(typeof overlay.position === "number" ? { position: overlay.position } : {}),
          ...(typeof overlay.duration === "number" ? { duration: overlay.duration } : {}),
        },
      };
    case "tapback-details":
      if (!requireLive(live, removed, overlay.messageId, atMs, `${base}/overlay/messageId`, issues, "tapback-details")) return undefined;
      return {
        type: "overlay",
        atMs,
        overlay: {
          kind: "tapback-details",
          messageId: String(overlay.messageId),
          ...(overlay.filter === null || typeof overlay.filter === "string" ? { filter: overlay.filter as string | null } : {}),
        },
      };
    case "sticker-picker":
      return { type: "overlay", atMs, overlay: { kind: "sticker-picker", ...(typeof overlay.tab === "string" ? { tab: overlay.tab } : {}) } };
    case "poll-details":
      if (!requireLive(live, removed, overlay.messageId, atMs, `${base}/overlay/messageId`, issues, "poll-details")) return undefined;
      return { type: "overlay", atMs, overlay: { kind: "poll-details", messageId: String(overlay.messageId) } };
    case "selection": {
      if (!Array.isArray(overlay.messageIds)) {
        issues.push(issue(`${base}/overlay/messageIds`, "INVALID_TYPE", "selection messageIds must be an array"));
        return undefined;
      }
      const messageIds: string[] = [];
      for (const id of overlay.messageIds) {
        if (!requireLive(live, removed, id, atMs, `${base}/overlay/messageIds`, issues, "selection")) return undefined;
        messageIds.push(String(id));
      }
      return { type: "overlay", atMs, overlay: { kind: "selection", messageIds } };
    }
    default:
      issues.push(issue(`${base}/overlay/kind`, "INVALID_VALUE", `unknown overlay ${JSON.stringify(overlay.kind)}`));
      return undefined;
  }
}

function parseAudioEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "audio-control");
  if (!message || atMs === undefined || typeof value.messageId !== "string") return undefined;
  if (message.kind !== "audio") {
    issues.push(issue(`${base}/messageId`, "INVALID_VALUE", "audio control target must be an audio message"));
    return undefined;
  }
  if (typeof value.position !== "number" || value.position < 0 || (message.audioDuration !== undefined && value.position > message.audioDuration)) {
    issues.push(issue(`${base}/position`, "INVALID_VALUE", "audio position must fall within the message duration"));
    return undefined;
  }
  if (typeof value.playing !== "boolean") return undefined;
  return {
    type: "audio-control",
    atMs,
    messageId: value.messageId,
    position: value.position,
    playing: value.playing,
    ...(typeof value.seeking === "boolean" ? { seeking: value.seeking } : {}),
  };
}

function requireIos(platform: DemoPlatform | undefined, base: string, label: string, issues: ValidationIssue[]): boolean {
  if (platform === "macos") {
    issues.push(issue(base, "PLATFORM_MISMATCH", `${label} is an iOS event and is not a macOS target`));
    return false;
  }
  return true;
}

function parsePollOptionEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  platform: DemoPlatform | undefined,
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  if (!requireIos(platform, base, "poll-option", issues)) return undefined;
  const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "poll-option");
  if (!message || atMs === undefined || typeof value.optionId !== "string" || typeof value.text !== "string" || typeof value.messageId !== "string") return undefined;
  if (message.kind !== "poll") {
    issues.push(issue(`${base}/messageId`, "INVALID_VALUE", "poll-option target must be a poll"));
    return undefined;
  }
  if (message.pollOptionIds?.has(value.optionId)) {
    issues.push(issue(`${base}/optionId`, "DUPLICATE_ID", `duplicate poll option id ${JSON.stringify(value.optionId)}`));
    return undefined;
  }
  message.pollOptionIds?.add(value.optionId);
  return { type: "poll-option", atMs, messageId: value.messageId, optionId: value.optionId, text: value.text };
}

function parsePollVoteEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  platform: DemoPlatform | undefined,
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  if (!requireIos(platform, base, "poll-vote", issues)) return undefined;
  const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "poll-vote");
  if (!message || atMs === undefined || typeof value.messageId !== "string") return undefined;
  if (message.kind !== "poll") {
    issues.push(issue(`${base}/messageId`, "INVALID_VALUE", "poll-vote target must be a poll"));
    return undefined;
  }
  const participantId = typeof value.participantId === "string" && value.participantId.length > 0
    ? value.participantId
    : typeof value.voterId === "string" && value.voterId.length > 0
      ? value.voterId
      : undefined;
  if (typeof value.participantId === "string" && typeof value.voterId === "string" && value.participantId !== value.voterId) {
    issues.push(issue(`${base}/voterId`, "INVALID_VALUE", "participantId and voterId must name the same voter"));
    return undefined;
  }
  if (!participantId || typeof value.optionId !== "string" || value.optionId.length === 0) return undefined;
  const voted = value.voted === undefined ? true : value.voted;
  if (typeof voted !== "boolean") {
    issues.push(issue(`${base}/voted`, "INVALID_TYPE", "poll-vote voted must be a boolean"));
    return undefined;
  }
  if (message.pollOptionIds && !message.pollOptionIds.has(value.optionId)) {
    issues.push(issue(`${base}/optionId`, "INVALID_REFERENCE", `poll-vote option ${JSON.stringify(value.optionId)} is not on that poll`));
    return undefined;
  }
  if (message.pollVoterIds && !message.pollVoterIds.has(participantId)) {
    issues.push(issue(`${base}/participantId`, "INVALID_REFERENCE", `poll-vote voter ${JSON.stringify(participantId)} is not on that poll`));
    return undefined;
  }
  return { type: "poll-vote", atMs, messageId: value.messageId, participantId, optionId: value.optionId, voted };
}

function parseStickerEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  platform: DemoPlatform | undefined,
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  if (!requireIos(platform, base, "sticker", issues)) return undefined;
  const message = requireLive(live, removed, value.messageId, atMs, `${base}/messageId`, issues, "sticker");
  if (!message || atMs === undefined || typeof value.messageId !== "string") return undefined;
  if (value.sticker === null) return { type: "sticker", atMs, messageId: value.messageId, sticker: null };
  if (!isPlainObject(value.sticker) || typeof value.sticker.id !== "string" || typeof value.sticker.glyph !== "string" || typeof value.sticker.label !== "string") {
    issues.push(issue(`${base}/sticker`, "INVALID_VALUE", "sticker event requires a sticker or null"));
    return undefined;
  }
  return {
    type: "sticker",
    atMs,
    messageId: value.messageId,
    sticker: {
      id: value.sticker.id,
      glyph: value.sticker.glyph,
      label: value.sticker.label,
      ...(typeof value.sticker.rotation === "number" ? { rotation: value.sticker.rotation } : {}),
    },
  };
}

function parseNoticeEvent(
  value: Record<string, unknown>,
  base: string,
  issues: ValidationIssue[],
  live: Map<string, LiveMessage>,
  removed: Set<string>,
  atMs: number | undefined,
): CompiledEvent | undefined {
  const notice = value.notice;
  if (!isPlainObject(notice) || atMs === undefined) {
    issues.push(issue(`${base}/notice`, "INVALID_TYPE", "notice must be an object"));
    return undefined;
  }
  if (notice.kind === "unknown-sender") return { type: "notice", atMs, notice: { kind: "unknown-sender" } };
  if (notice.kind === "not-delivered") {
    if (!requireLive(live, removed, notice.messageId, atMs, `${base}/notice/messageId`, issues, "notice")) return undefined;
    return { type: "notice", atMs, notice: { kind: "not-delivered", messageId: String(notice.messageId) } };
  }
  if (notice.kind === "missed-call" && (notice.call === "audio" || notice.call === "video")) {
    return { type: "notice", atMs, notice: { kind: "missed-call", call: notice.call } };
  }
  issues.push(issue(`${base}/notice/kind`, "INVALID_VALUE", "notice must be unknown-sender, not-delivered, or a missed audio or video call"));
  return undefined;
}
