import type { ReactNode, Ref } from "react";
import { z } from "zod";
import { sheetAppSchema, type SheetAppSpec } from "./sheet-app";
export { sheetAppSchema, type SheetAppSpec } from "./sheet-app";

/**
 * Canonical authoring and timeline contract.
 * Upstream prop types stay in src/components/imessage. Agents author a
 * DemoFlow. The compiler emits one CompiledEvent stream. The runtime
 * projects that stream. Renderers do not invent a second timeline.
 */

export function notImplemented(symbol: string): never {
  throw new Error(`NOT_IMPLEMENTED: ${symbol}`);
}

export const messageKindSchema = z.enum(["text", "link", "attachment", "image", "audio", "app-card", "system", "facetime", "sticker", "poll", "video"]);
export const directionSchema = z.enum(["incoming", "outgoing"]);
export const serviceSchema = z.enum(["imessage", "sms"]);
export const statusSchema = z.enum(["sending", "sent", "delivered", "read", "failed"]);
export const platformSchema = z.enum(["ios", "macos"]);
/**
 * The messaging app a demo wears. `imessage` (default) and `sms` use the pinned Messages UI; the
 * others use repository-owned chat renderers that read the same compiled timeline. Non-Messages
 * channels are iOS-sized phone frames only.
 */
export const channelSchema = z.enum(["imessage", "sms", "whatsapp", "telegram", "slack"]);
export const themeSchema = z.enum(["light", "dark"]);
export const iosScreenSchema = z.enum(["list", "conversation", "new-message"]);
export const bubbleEffectSchema = z.enum(["slam", "loud", "gentle", "invisible-ink"]);
export const screenEffectSchema = z.enum(["echo", "spotlight", "balloons", "confetti", "love", "lasers", "fireworks", "celebration"]);

export type MessageKind = z.infer<typeof messageKindSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type MessageStatus = z.infer<typeof statusSchema>;
export type DemoPlatform = z.infer<typeof platformSchema>;
export type DemoChannel = z.infer<typeof channelSchema>;
export const MESSAGES_CHANNELS: ReadonlySet<DemoChannel> = new Set(["imessage", "sms"]);
export type DemoTheme = z.infer<typeof themeSchema>;
export type IosScreenName = z.infer<typeof iosScreenSchema>;
export type BubbleEffectName = z.infer<typeof bubbleEffectSchema>;
export type ScreenEffectName = z.infer<typeof screenEffectSchema>;

export const reactionSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.string().min(1),
  byMe: z.boolean().optional(),
  emoji: z.string().optional(),
  messageId: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
});

export const replySnapshotSchema = z.object({
  id: z.string().min(1),
  text: z.string().optional(),
  direction: directionSchema.optional(),
  service: serviceSchema.optional(),
  sender: z.string().optional(),
});

export const linkPayloadSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
  host: z.string().optional(),
  image: z.string().min(1).optional(),
});

export const attachmentPayloadSchema = z.object({
  name: z.string().min(1),
  size: z.string().optional(),
  href: z.string().min(1).optional(),
});

/**
 * A live Photon checkout card, named after Photon's `appCard(url, { live: true })`. iOS only. The
 * renderer embeds `url` in the thread when its origin is in the renderer's configured checkout origins
 * and presents the recreated Apple Pay sheet when the checkout asks. app "miniapp" instead shows a
 * tappable metadata card and an isolated web sheet; it never uses the checkout bridge.
 */
export const APP_CARD_MIN_HEIGHT = 120;
export const APP_CARD_MAX_HEIGHT = 480;
export const APP_CARD_DEFAULT_HEIGHT = 240;

export const POLL_MAX_OPTIONS = 12;

export const systemMessageEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unknownSender") }),
  z.object({ type: z.literal("conversationNamed"), actor: z.string().min(1).optional(), name: z.string().min(1) }),
  z.object({ type: z.literal("conversationNameRemoved"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("participantAdded"), actor: z.string().min(1).optional(), participant: z.string().min(1).optional() }),
  z.object({ type: z.literal("participantRemoved"), actor: z.string().min(1).optional(), participant: z.string().min(1).optional() }),
  z.object({ type: z.literal("participantLeft"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("groupPhotoChanged"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("groupPhotoRemoved"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("backgroundChanged"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("backgroundRemoved"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("messageUnsent"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("messageKept"), actor: z.string().min(1).optional(), what: z.string().min(1), from: z.string().min(1).optional() }),
  z.object({ type: z.literal("phoneNumberChanged"), actor: z.string().min(1).optional() }),
  z.object({ type: z.literal("addFailed"), participant: z.string().min(1) }),
  z.object({ type: z.literal("removeFailed"), participant: z.string().min(1) }),
]);

export const facetimeStateSchema = z.enum(["invitation", "ringing", "connected", "ended", "missed"]);

export const stickerPayloadSchema = z.object({
  id: z.string().min(1),
  glyph: z.string().min(1),
  label: z.string().min(1),
  rotation: z.number().optional(),
});

export const pollSelectionModeSchema = z.enum(["single", "multiple"]);

export const pollOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const pollVoteSchema = z.object({
  participantId: z.string().min(1),
  optionId: z.string().min(1),
  /** Canonical time the vote was applied. Omitted on an opening selection, which is already settled. */
  atMs: z.number().int().nonnegative().optional(),
});

export const pollVoterSchema = z.object({
  id: z.string().min(1),
  avatar: z.string().min(1),
});

export const pollPayloadSchema = z.object({
  /** Empty hides the heading. The recorded poll has no visible question. */
  question: z.string(),
  selectionMode: pollSelectionModeSchema.optional(),
  options: z.array(pollOptionSchema).min(1).max(POLL_MAX_OPTIONS),
  votes: z.array(pollVoteSchema).optional(),
  voters: z.array(pollVoterSchema).optional(),
});

export const participantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  initials: z.string().optional(),
  photo: z.string().min(1).optional(),
  me: z.boolean().optional(),
});

export const groupSchema = z.object({
  name: z.string().min(1).optional(),
  photo: z.string().min(1).optional(),
});

export const libraryPhotoSchema = z.object({
  id: z.string().min(1),
  src: z.string().min(1),
  alt: z.string().min(1),
});

export const miniAppLayoutSchema = z.object({
  caption: z.string().trim().min(1).max(80),
  subcaption: z.string().trim().min(1).max(240).optional(),
  summary: z.string().trim().min(1).max(280),
  image: z.string().regex(/^\/demo-assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif)$/).optional(),
  imageTitle: z.string().trim().min(1).max(160).optional(),
}).strict().refine(value => Boolean(value.image) === Boolean(value.imageTitle), { message: "image and imageTitle must be supplied together" });

export const appCardPayloadSchema = z.object({
  url: z.string().min(1),
  live: z.literal(true),
  app: z.enum(["checkout", "miniapp", "sheet"]),
  sheet: sheetAppSchema.optional(),
  layout: miniAppLayoutSchema.optional(),
  height: z.number().int().min(APP_CARD_MIN_HEIGHT).max(APP_CARD_MAX_HEIGHT).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.app === 'miniapp' ? !value.layout : value.layout !== undefined) ctx.addIssue({ code: 'custom', path: ['layout'], message: 'layout is required for miniapp only' });
  if (value.app === 'sheet' ? !value.sheet || value.url !== value.sheet.content.entry : value.sheet !== undefined) ctx.addIssue({ code: 'custom', path: ['sheet'], message: 'sheet spec is required only for sheet; url must equal content.entry' });
});

export const videoPayloadSchema = z.object({
  src: z.string().min(1),
  poster: z.string().min(1).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
}).strict();

export const demoMessageSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  direction: directionSchema,
  atMs: z.number().int(),
  kind: messageKindSchema.optional(),
  service: serviceSchema.optional(),
  status: statusSchema.optional(),
  effect: bubbleEffectSchema.optional(),
  link: linkPayloadSchema.optional(),
  attachments: z.array(attachmentPayloadSchema).optional(),
  images: z.array(z.object({ src: z.string().min(1), alt: z.string(), width: z.number().optional(), height: z.number().optional() })).optional(),
  audio: z.object({
    duration: z.number().nonnegative(),
    peaks: z.array(z.number()).optional(),
    src: z.string().min(1).optional(),
  }).optional(),
  video: videoPayloadSchema.optional(),
  appCard: appCardPayloadSchema.optional(),
  sender: z.string().min(1).optional(),
  senderId: z.string().min(1).optional(),
  senderInitials: z.string().optional(),
  senderPhoto: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  system: systemMessageEventSchema.optional(),
  facetime: z.object({ state: facetimeStateSchema, duration: z.string().optional() }).optional(),
  sticker: stickerPayloadSchema.optional(),
  stickers: z.array(stickerPayloadSchema).optional(),
  poll: pollPayloadSchema.optional(),
  reactions: z.array(reactionSchema).optional(),
  replyTo: z.union([z.string().min(1), replySnapshotSchema]).optional(),
  edited: z.boolean().optional(),
  readAt: z.number().int().nonnegative().optional(),
  revealed: z.boolean().optional(),
  removed: z.boolean().optional(),
});

export const classicTapbackSchema = z.enum(["love", "like", "dislike", "laugh", "emphasize", "question"]);

/** Transient picker choice on a long-press overlay. It is not a committed reaction. */
export const pickerSelectionSchema = z.union([
  z.object({ type: classicTapbackSchema }),
  z.object({ emoji: z.string().min(1) }),
]);

export const overlayStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("closed") }),
  z.object({ kind: z.literal("thread"), rootId: z.string().min(1) }),
  z.object({
    kind: z.literal("long-press"),
    messageId: z.string().min(1),
    selected: pickerSelectionSchema.nullable().optional(),
  }),
  z.object({ kind: z.literal("context-menu"), messageId: z.string().min(1), x: z.number(), y: z.number() }),
  z.object({ kind: z.literal("plus-menu") }),
  z.object({
    kind: z.literal("effects-picker"),
    tab: z.enum(["bubble", "screen"]),
    draft: z.string(),
    effect: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("details") }),
  z.object({
    kind: z.literal("photo-picker"),
    selectedId: z.string().min(1).optional(),
    selectedIds: z.array(z.string().min(1)).optional(),
    detent: z.enum(["collapsed", "expanded"]).optional(),
  }),
  z.object({ kind: z.literal("selection"), messageIds: z.array(z.string().min(1)) }),
  z.object({ kind: z.literal("search"), query: z.string() }),
  z.object({
    kind: z.literal("recorder"),
    state: z.enum(["recording", "stopped", "playing"]),
    position: z.number().nonnegative().optional(),
    duration: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("tapback-details"),
    messageId: z.string().min(1),
    filter: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal("sticker-picker"), tab: z.string().min(1).optional() }),
  z.object({ kind: z.literal("poll-details"), messageId: z.string().min(1) }),
  z.object({
    kind: z.literal("image-viewer"),
    messageId: z.string().min(1),
    index: z.number().int().nonnegative(),
    zoom: z.number().positive().optional(),
    chrome: z.boolean().optional(),
    dismiss: z.number().min(0).max(1).optional(),
  }),
]);

export const systemNoticeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown-sender") }),
  z.object({ kind: z.literal("not-delivered"), messageId: z.string().min(1) }),
  z.object({ kind: z.literal("missed-call"), call: z.enum(["audio", "video"]) }),
]);

export const compiledEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sheet-app"), atMs: z.number().int(), sourceIndex: z.number().int().optional(), messageId: z.string().min(1), action: z.enum(["open", "compact", "expand", "close"]) }).strict(),
  z.object({
    type: z.literal("message"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1).optional(),
    message: demoMessageSchema,
  }),
  z.object({
    type: z.literal("typing"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1).optional(),
    typing: z.boolean(),
  }),
  z.object({
    type: z.literal("draft"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1).optional(),
    value: z.string(),
  }),
  z.object({
    type: z.literal("status"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    messageId: z.string().min(1),
    status: statusSchema,
  }),
  z.object({
    type: z.literal("reaction"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    messageId: z.string().min(1),
    reactionId: z.string().min(1),
    reaction: z.union([
      z.object({ type: z.string().min(1), byMe: z.boolean().optional(), emoji: z.string().optional() }),
      z.null(),
    ]),
  }),
  z.object({
    type: z.literal("edit"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    messageId: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    type: z.literal("remove"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    messageId: z.string().min(1),
  }),
  z.object({
    type: z.literal("reveal"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    messageId: z.string().min(1),
    revealed: z.boolean(),
  }),
  z.object({
    type: z.literal("screen"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    screen: iosScreenSchema,
  }),
  z.object({
    type: z.literal("select-conversation"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1),
    contact: z.object({ name: z.string().min(1), initials: z.string().optional() }).optional(),
  }),
  z.object({
    type: z.literal("scroll"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1).optional(),
    offset: z.number(),
  }),
  z.object({
    type: z.literal("window-active"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    active: z.boolean(),
  }),
  z.object({
    type: z.literal("overlay"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    overlay: overlayStateSchema,
  }),
  z.object({
    type: z.literal("screen-effect"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    effect: screenEffectSchema,
    messageId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("audio-control"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    messageId: z.string().min(1),
    position: z.number().nonnegative(),
    playing: z.boolean(),
    seeking: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("time-reveal"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    progress: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("notice"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    notice: systemNoticeSchema,
  }),
  z.object({
    type: z.literal("poll-option"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1).optional(),
    messageId: z.string().min(1),
    optionId: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("poll-vote"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1).optional(),
    messageId: z.string().min(1),
    participantId: z.string().min(1),
    optionId: z.string().min(1),
    voted: z.boolean(),
  }),
  z.object({
    type: z.literal("sticker"),
    atMs: z.number().int(),
    sourceIndex: z.number().int().optional(),
    conversationId: z.string().min(1).optional(),
    messageId: z.string().min(1),
    sticker: stickerPayloadSchema.nullable(),
  }),
]);

export const contactSchema = z.object({
  name: z.string().min(1),
  initials: z.string().optional(),
  photo: z.string().min(1).optional(),
  silhouette: z.boolean().optional(),
});

export const conversationSeedSchema = z.object({
  id: z.string().min(1),
  contact: contactSchema,
  participants: z.array(participantSchema).optional(),
  group: groupSchema.optional(),
  draft: z.string().optional(),
  typing: z.boolean().optional(),
});

export const demoFlowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  platform: platformSchema,
  channel: channelSchema.optional(),
  theme: themeSchema,
  contact: contactSchema,
  nowMs: z.number().int(),
  startAtMs: z.number().int().nonnegative().optional(),
  draft: z.string(),
  typing: z.boolean(),
  screen: iosScreenSchema,
  messages: z.array(demoMessageSchema),
  events: z.array(compiledEventSchema).optional(),
  participants: z.array(participantSchema).optional(),
  group: groupSchema.optional(),
  conversations: z.array(conversationSeedSchema).optional(),
  selectedConversationId: z.string().min(1).optional(),
  library: z.array(libraryPhotoSchema).optional(),
}).strict();

export type Reaction = {
  id: string;
  type: string;
  byMe?: boolean;
  emoji?: string;
};

export type AppCardPayload = { url: string; live: true; app: "checkout" | "miniapp" | "sheet"; sheet?: SheetAppSpec; height?: number; layout?: z.infer<typeof miniAppLayoutSchema> };

export type ReplySnapshot = {
  id: string;
  text: string;
  direction: Direction;
  service?: Service;
  sender?: string;
};

export type SystemMessagePayload = z.infer<typeof systemMessageEventSchema>;
export type FaceTimeStateName = z.infer<typeof facetimeStateSchema>;
export type StickerPayload = z.infer<typeof stickerPayloadSchema>;
export type PollPayload = z.infer<typeof pollPayloadSchema>;
export type PollVote = z.infer<typeof pollVoteSchema>;
export type DemoParticipant = z.infer<typeof participantSchema>;
export type DemoGroup = z.infer<typeof groupSchema>;
export type LibraryPhoto = z.infer<typeof libraryPhotoSchema>;
export type ConversationSeed = z.infer<typeof conversationSeedSchema>;
export type DemoContact = z.infer<typeof contactSchema>;

export type DemoMessage = {
  id: string;
  text: string;
  direction: Direction;
  atMs: number;
  kind?: MessageKind;
  service?: Service;
  status?: MessageStatus;
  effect?: BubbleEffectName;
  link?: { url: string; title?: string; host?: string; image?: string };
  attachments?: Array<{ name: string; size?: string; href?: string }>;
  images?: Array<{ src: string; alt: string; width?: number; height?: number }>;
  audio?: { duration: number; peaks?: number[]; src?: string };
  video?: z.infer<typeof videoPayloadSchema>;
  appCard?: AppCardPayload;
  reactions?: Reaction[];
  replyTo?: ReplySnapshot;
  edited?: boolean;
  readAt?: number;
  revealed?: boolean;
  removed?: boolean;
  sender?: string;
  senderId?: string;
  senderInitials?: string;
  senderPhoto?: string;
  conversationId?: string;
  system?: SystemMessagePayload;
  facetime?: { state: FaceTimeStateName; duration?: string };
  sticker?: StickerPayload;
  stickers?: StickerPayload[];
  poll?: PollPayload;
};

export type PickerSelection = z.infer<typeof pickerSelectionSchema>;

export type OverlayState =
  | { kind: "closed" }
  | { kind: "thread"; rootId: string }
  | { kind: "long-press"; messageId: string; selected?: PickerSelection | null }
  | { kind: "context-menu"; messageId: string; x: number; y: number }
  | { kind: "plus-menu" }
  | { kind: "effects-picker"; tab: "bubble" | "screen"; draft: string; effect?: string }
  | { kind: "image-viewer"; messageId: string; index: number; zoom?: number; chrome?: boolean; dismiss?: number }
  | { kind: "details" }
  | { kind: "photo-picker"; selectedId?: string; selectedIds?: string[]; detent?: "collapsed" | "expanded" }
  | { kind: "selection"; messageIds: string[] }
  | { kind: "search"; query: string }
  | { kind: "recorder"; state: "recording" | "stopped" | "playing"; position?: number; duration?: number }
  | { kind: "tapback-details"; messageId: string; filter?: string | null }
  | { kind: "sticker-picker"; tab?: string }
  | { kind: "poll-details"; messageId: string };

export type SystemNotice =
  | { kind: "unknown-sender" }
  | { kind: "not-delivered"; messageId: string }
  | { kind: "missed-call"; call: "audio" | "video" };

export type AudioControlState = {
  messageId: string;
  position: number;
  playing: boolean;
  seeking?: boolean;
};

export type CompiledEvent =
  | { type: "sheet-app"; atMs: number; sourceIndex?: number; messageId: string; action: "open" | "compact" | "expand" | "close" }
  | { type: "message"; atMs: number; sourceIndex?: number; conversationId?: string; message: DemoMessage }
  | { type: "typing"; atMs: number; sourceIndex?: number; conversationId?: string; typing: boolean }
  | { type: "draft"; atMs: number; sourceIndex?: number; conversationId?: string; value: string }
  | { type: "status"; atMs: number; sourceIndex?: number; messageId: string; status: MessageStatus }
  | { type: "reaction"; atMs: number; sourceIndex?: number; messageId: string; reactionId: string; reaction: { type: string; byMe?: boolean; emoji?: string } | null }
  | { type: "edit"; atMs: number; sourceIndex?: number; messageId: string; text: string }
  | { type: "remove"; atMs: number; sourceIndex?: number; messageId: string }
  | { type: "reveal"; atMs: number; sourceIndex?: number; messageId: string; revealed: boolean }
  | { type: "screen"; atMs: number; sourceIndex?: number; screen: IosScreenName }
  | { type: "select-conversation"; atMs: number; sourceIndex?: number; conversationId: string; contact?: { name: string; initials?: string } }
  | { type: "scroll"; atMs: number; sourceIndex?: number; conversationId?: string; offset: number }
  | { type: "window-active"; atMs: number; sourceIndex?: number; active: boolean }
  | { type: "overlay"; atMs: number; sourceIndex?: number; overlay: OverlayState }
  | { type: "screen-effect"; atMs: number; sourceIndex?: number; effect: ScreenEffectName; messageId?: string }
  | { type: "audio-control"; atMs: number; sourceIndex?: number; messageId: string; position: number; playing: boolean; seeking?: boolean }
  | { type: "time-reveal"; atMs: number; sourceIndex?: number; progress: number }
  | { type: "notice"; atMs: number; sourceIndex?: number; notice: SystemNotice }
  | { type: "poll-option"; atMs: number; sourceIndex?: number; conversationId?: string; messageId: string; optionId: string; text: string }
  | { type: "poll-vote"; atMs: number; sourceIndex?: number; conversationId?: string; messageId: string; participantId: string; optionId: string; voted: boolean }
  | { type: "sticker"; atMs: number; sourceIndex?: number; conversationId?: string; messageId: string; sticker: StickerPayload | null };

export type InitialConversation = {
  id: string;
  contact?: { name: string; initials?: string };
  messages?: readonly DemoMessage[];
  draft?: string;
  typing?: boolean;
  scroll?: number;
};

export type InitialState = {
  conversations?: readonly InitialConversation[];
  selectedConversationId?: string;
  screen?: IosScreenName;
  windowActive?: boolean;
  overlay?: OverlayState;
};

export type DemoFlow = {
  id: string;
  title: string;
  platform: DemoPlatform;
  /** Omitted means imessage. */
  channel?: DemoChannel;
  theme: DemoTheme;
  contact: DemoContact;
  nowMs: number;
  /** Optional opening time on the message clock, allowing a draft before the first send. */
  startAtMs?: number;
  draft: string;
  typing: boolean;
  screen: IosScreenName;
  messages: DemoMessage[];
  events?: CompiledEvent[];
  participants?: DemoParticipant[];
  group?: DemoGroup;
  conversations?: ConversationSeed[];
  selectedConversationId?: string;
  library?: LibraryPhoto[];
};

export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { ok: true; demo: DemoFlow } | { ok: false; issues: ValidationIssue[] };

export type CompiledDemo = {
  id: string;
  platform: DemoPlatform;
  channel?: DemoChannel;
  theme: DemoTheme;
  durationMs: number;
  contact: DemoFlow["contact"];
  nowMs: number;
  screen: IosScreenName;
  events: CompiledEvent[];
  initialState?: InitialState;
  reducedMotion?: boolean;
  participants?: DemoParticipant[];
  group?: DemoGroup;
  conversations?: ConversationSeed[];
  selectedConversationId?: string;
  library?: LibraryPhoto[];
};

export type PlaybackState = {
  timeMs: number;
  playing: boolean;
  durationMs: number;
};

export type RenderFrame = {
  timeMs: number;
  platform: DemoPlatform;
  theme: DemoTheme;
  screen: IosScreenName;
  contact: DemoFlow["contact"];
  nowMs: number;
  messages: DemoMessage[];
  typing: boolean;
  draft: string;
};

export type RendererProps = {
  compiled: CompiledDemo;
  frame: RenderFrame;
};

export type RendererHandle = {
  seek(timeMs: number): void;
  readonly element: HTMLElement | null;
};

export type CatalogueTier = "supported" | "catalogue-only";

export type CatalogueSceneDefinition = {
  id: string;
  title: string;
  platform: DemoPlatform | "both";
  tier: CatalogueTier;
  sourceAnchors: string[];
  summary: string;
};

export type CatalogueSceneProps = {
  scene: CatalogueSceneDefinition;
  theme: DemoTheme;
  children?: ReactNode;
};

export type DemoPlayerProps = {
  compiled: CompiledDemo;
  ref?: Ref<RendererHandle>;
};

export type Player = {
  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  reset?(): void;
  setDuration?(timeMs: number): void;
  state(): PlaybackState;
  frame(): RenderFrame;
};
