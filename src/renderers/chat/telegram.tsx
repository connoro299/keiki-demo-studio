import type { CSSProperties } from "react";
import { CHAT_MESSAGE_KINDS, durationLabel, hostOf, linkRuns, waveformBars, type ChatMessageView, type ChatModel, type ChatPerson } from "./engine";
import {
  Arrive, Avatar, BubbleTail, ChatVideo, Checks, DISPLAY_FONT, HOME_AREA_HEIGHT, HomeIndicator, STATUS_BAR_HEIGHT, SYSTEM_FONT, StatusBar,
  TELEGRAM_GLYPHS, doodleWallpaper, imageBox,
} from "./shared";
import { TypingDots } from "./typing";
import { Caret, popScale } from "./whatsapp";

/**
 * Telegram for iPhone: pastel gradient wallpaper with a doodle pattern, centred name + status
 * header with the avatar on the right, #E1FFC7 outgoing bubbles with green ticks, reactions
 * inside the bubble, paperclip + mic composer.
 */

const palettes = {
  light: {
    base: "#B7CB97",
    gradient: "radial-gradient(120% 70% at 8% 6%, #E2E3BF 0%, rgba(226,227,191,0) 60%), radial-gradient(90% 60% at 96% 28%, #79AE8E 0%, rgba(121,174,142,0) 62%), radial-gradient(100% 65% at 6% 92%, #8DBB86 0%, rgba(141,187,134,0) 60%), radial-gradient(110% 70% at 92% 96%, #D8DB92 0%, rgba(216,219,146,0) 62%)",
    pattern: "rgba(28,58,20,0.17)",
    patternMode: "stroke" as const,
    bar: "#F7F7F7",
    hairline: "rgba(0,0,0,0.2)",
    accent: "#007AFF",
    text: "#000000",
    secondary: "#8E8E93",
    inBubble: "#FFFFFF",
    outBubble: "#E1FFC7",
    metaIn: "#A1AAB3",
    metaOut: "#4FAE4E",
    check: "#4FAE4E",
    link: "#007AFF",
    linkOut: "#2A9A2F",
    quoteIn: "rgba(0,122,255,0.1)",
    quoteOut: "rgba(79,174,78,0.16)",
    barIn: "#007AFF",
    barOut: "#4FAE4E",
    reactionIn: "rgba(0,122,255,0.12)",
    reactionOut: "rgba(79,174,78,0.2)",
    reactionInMine: "#007AFF",
    reactionOutMine: "#5CB158",
    field: "#FFFFFF",
    fieldBorder: "rgba(0,0,0,0.14)",
    glyph: "#858E99",
    service: "rgba(76,104,52,0.42)",
    statusBar: "#000000",
    home: "#000000",
    names: ["#CC5049", "#D67722", "#955CDB", "#40A920", "#309EBA", "#368AD1", "#C7508B"],
  },
  dark: {
    base: "#0E1621",
    gradient: "radial-gradient(120% 70% at 10% 8%, #13202E 0%, rgba(19,32,46,0) 60%), radial-gradient(100% 70% at 92% 92%, #101B27 0%, rgba(16,27,39,0) 60%)",
    pattern: "rgba(122,166,214,0.075)",
    patternMode: "stroke" as const,
    bar: "#17212B",
    hairline: "rgba(0,0,0,0.5)",
    accent: "#5EB5F7",
    text: "#F5F5F5",
    secondary: "#7F91A4",
    inBubble: "#182533",
    outBubble: "#2B5278",
    metaIn: "#6D7F8F",
    metaOut: "#7DA8D3",
    check: "#7DB8EE",
    link: "#71BAFA",
    linkOut: "#9CCBF6",
    quoteIn: "rgba(94,181,247,0.12)",
    quoteOut: "rgba(255,255,255,0.1)",
    barIn: "#5EB5F7",
    barOut: "#B4D9FA",
    reactionIn: "rgba(94,181,247,0.16)",
    reactionOut: "rgba(255,255,255,0.12)",
    reactionInMine: "#3E88C8",
    reactionOutMine: "#5E8BB7",
    field: "#0E1621",
    fieldBorder: "rgba(255,255,255,0.08)",
    glyph: "#7F91A4",
    service: "rgba(0,0,0,0.35)",
    statusBar: "#FFFFFF",
    home: "#FFFFFF",
    names: ["#FF8E86", "#FFA357", "#B18FFF", "#4FCE5D", "#40D8D0", "#52BFFF", "#FF7FD5"],
  },
};

type Palette = typeof palettes.light;
const HEADER_HEIGHT = 52;

export function TelegramScreen({ model }: { model: ChatModel }) {
  const p = palettes[model.theme];
  const pattern = doodleWallpaper({ stroke: p.pattern, names: TELEGRAM_GLYPHS, tile: 260, count: 42, seed: 23, strokeWidth: 1.5, sizeScale: 0.82 });
  return (
    <div data-skin="telegram" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: p.base, fontFamily: SYSTEM_FONT, color: p.text, WebkitFontSmoothing: "antialiased" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: p.gradient }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: pattern, backgroundSize: "260px 260px" }} />
      <Header model={model} p={p} />
      <div data-slot="chat-thread" style={{ position: "relative", flex: "1 1 auto", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingTop: STATUS_BAR_HEIGHT + HEADER_HEIGHT, paddingBottom: 6 }}>
        <ServiceChip p={p} label={model.dayLabel} />
        {model.messages.map((view) => (
          <Arrive key={view.id} id={view.id} enter={view.enter} origin={view.side === "out" ? "bottom right" : "bottom left"}>
            <MessageRow view={view} model={model} p={p} />
          </Arrive>
        ))}
      </div>
      <Composer model={model} p={p} />
      <StatusBar time={model.statusTime} color={p.statusBar} />
      <HomeIndicator color={p.home} />
    </div>
  );
}

function Header({ model, p }: { model: ChatModel; p: Palette }) {
  const title = model.group ? model.groupName ?? model.contact.name : model.contact.name;
  const members = model.participants.length + 1;
  return (
    <div data-slot="chat-header" style={{ position: "absolute", left: 0, right: 0, top: 0, height: STATUS_BAR_HEIGHT + HEADER_HEIGHT, background: p.bar, boxShadow: `0 0.33px 0 ${p.hairline}`, zIndex: 30 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: STATUS_BAR_HEIGHT, height: HEADER_HEIGHT }}>
        <div style={{ position: "absolute", left: 8, top: 0, height: HEADER_HEIGHT, display: "flex", alignItems: "center", color: p.accent, fontSize: 17, letterSpacing: -0.4 }}>
          <svg width="13" height="21" viewBox="0 0 13 21" aria-hidden><path d="M11 1.8L2.6 10.5 11 19.2" fill="none" stroke={p.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ marginLeft: 5 }}>Chats</span>
        </div>
        <div style={{ position: "absolute", left: 96, right: 96, top: 6, textAlign: "center" }}>
          <div style={{ fontFamily: DISPLAY_FONT, fontSize: 16.5, lineHeight: "20px", fontWeight: 600, letterSpacing: -0.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: p.text }}>{title}</div>
          <div style={{ fontSize: 13, lineHeight: "17px", color: model.group && !model.typing.visible ? p.secondary : p.accent, whiteSpace: "nowrap", display: "flex", justifyContent: "center", alignItems: "baseline", gap: 3, letterSpacing: -0.1 }}>
            {model.typing.visible ? (
              <>
                <span>{model.group ? `${model.typing.who.name.split(" ")[0]} is typing` : "typing"}</span>
                <TypingDots elapsed={model.typing.elapsed} color={p.accent} size={3.2} gap={2} rise={1.2} />
              </>
            ) : model.group ? `${members} members` : "online"}
          </div>
        </div>
        <div style={{ position: "absolute", right: 12, top: 7.5 }}>
          <Avatar person={model.contact} size={37} />
        </div>
      </div>
    </div>
  );
}

function ServiceChip({ p, label }: { p: Palette; label: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 6px", flexShrink: 0 }}>
      <div style={{ background: p.service, color: "#FFFFFF", borderRadius: 11, padding: "2px 8px 3px", fontSize: 13, lineHeight: "17px", fontWeight: 500, backdropFilter: "blur(10px)" }}>{label}</div>
    </div>
  );
}

function nameColor(person: ChatPerson, p: Palette): string {
  return p.names[person.colorIndex % p.names.length];
}

function MessageRow({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const out = view.side === "out";
  const showAvatar = model.group && !out;
  return (
    <div data-message-id={view.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start", alignItems: "flex-end", padding: out ? "0 13px 0 52px" : showAvatar ? "0 52px 0 6px" : "0 52px 0 13px", marginTop: view.firstOfGroup ? 7 : 2 }}>
      {showAvatar ? <div style={{ width: 34, marginRight: 6, flexShrink: 0 }}>{view.lastOfGroup ? <Avatar person={view.sender} size={34} /> : null}</div> : null}
      {view.emojiOnly ? <EmojiOnly view={view} p={p} /> : <Bubble view={view} model={model} p={p} />}
    </div>
  );
}

function EmojiOnly({ view, p }: { view: ChatMessageView; p: Palette }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: view.side === "out" ? "flex-end" : "flex-start" }}>
      <div style={{ fontSize: 52, lineHeight: "60px" }}>{view.message.text.trim()}</div>
      <div style={{ background: p.service, borderRadius: 10, padding: "1px 7px" }}><Meta view={view} p={p} light /></div>
    </div>
  );
}

function Bubble({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const out = view.side === "out";
  const message = view.message;
  const kind = message.kind ?? (message.images?.length ? "image" : message.link ? "link" : "text");
  const native = CHAT_MESSAGE_KINDS.has(kind);
  const media = native && (kind === "image" || kind === "video");
  const color = out ? p.outBubble : p.inBubble;
  const big = 17;
  const small = 6;
  const radius: CSSProperties = out
    ? { borderTopLeftRadius: big, borderBottomLeftRadius: big, borderTopRightRadius: view.firstOfGroup ? big : small, borderBottomRightRadius: view.lastOfGroup ? 0 : small }
    : { borderTopRightRadius: big, borderBottomRightRadius: big, borderTopLeftRadius: view.firstOfGroup ? big : small, borderBottomLeftRadius: view.lastOfGroup ? 0 : small };
  const showName = model.group && !out && view.firstOfGroup;
  return (
    <div style={{ position: "relative", maxWidth: media ? 280 : 334, minWidth: 0 }}>
      <div style={{ position: "relative", background: color, ...radius, padding: media ? 2 : "6px 10px 7px 11px", overflow: "hidden" }}>
        {showName ? <div style={{ fontSize: 14.5, lineHeight: "18px", fontWeight: 600, color: nameColor(view.sender, p), padding: media ? "4px 8px 4px" : "0 0 1px", letterSpacing: -0.15 }}>{view.sender.name}</div> : null}
        {message.replyTo ? <Quote view={view} model={model} p={p} /> : null}
        {!native || kind === "text" ? <TextBody view={view} p={p} /> : null}
        {kind === "link" ? <LinkBody view={view} p={p} /> : null}
        {kind === "image" ? <ImageBody view={view} p={p} /> : null}
        {kind === "video" ? <VideoBody view={view} model={model} p={p} /> : null}
        {kind === "attachment" ? <AttachmentBody view={view} p={p} /> : null}
        {kind === "audio" ? <AudioBody view={view} p={p} /> : null}
      </div>
      {view.lastOfGroup ? <BubbleTail side={view.side} color={color} protrude={7.5} height={17} /> : null}
    </div>
  );
}

function metaWidth(view: ChatMessageView): number {
  return Math.round(view.time.length * 6.3 + (view.message.edited ? 40 : 0) + (view.side === "out" ? 20 : 0) + 2);
}

function Meta({ view, p, light = false }: { view: ChatMessageView; p: Palette; light?: boolean }) {
  const out = view.side === "out";
  const color = light ? "#FFFFFF" : out ? p.metaOut : p.metaIn;
  const read = view.status === "read";
  const secondCheck = read ? (view.previousStatus === "read" ? 1 : view.statusChange) : 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11.5, lineHeight: "15px", color, whiteSpace: "nowrap", letterSpacing: 0.1 }}>
      {view.message.edited ? <span style={{ marginRight: 2 }}>edited</span> : null}
      <span>{view.time}</span>
      {out && view.status && view.status !== "failed" && view.status !== "sending" ? (
        <span style={{ position: "relative", width: 17, height: 11, marginLeft: 1 }}>
          <Checks double={false} color={light ? "#FFFFFF" : p.check} width={17} height={11} style={{ position: "absolute", left: -2, top: 0 }} />
          <Checks double={false} color={light ? "#FFFFFF" : p.check} width={17} height={11} style={{ position: "absolute", left: 2, top: 0, opacity: secondCheck, transform: `scale(${0.6 + 0.4 * secondCheck})`, transformOrigin: "center" }} />
        </span>
      ) : null}
    </span>
  );
}

function Runs({ text, color }: { text: string; color: string }) {
  return <>{linkRuns(text).map((run, index) => run.url ? <span key={index} style={{ color }}>{run.text}</span> : <span key={index}>{run.text}</span>)}</>;
}

const textStyle: CSSProperties = { fontSize: 17, lineHeight: "22px", letterSpacing: -0.3, whiteSpace: "pre-wrap", overflowWrap: "break-word" };

function TextBody({ view, p, text, reactions = true }: { view: ChatMessageView; p: Palette; text?: string; reactions?: boolean }) {
  const value = text ?? view.message.text;
  const out = view.side === "out";
  const hasReactions = reactions && view.reactions.length > 0;
  return (
    <div style={{ position: "relative" }}>
      <div style={textStyle}>
        <Runs text={value} color={out ? p.linkOut : p.link} />
        {hasReactions ? null : <span style={{ display: "inline-block", width: metaWidth(view) + 4, height: 1 }} />}
      </div>
      {hasReactions ? <Reactions view={view} p={p} /> : null}
      <span style={{ position: "absolute", right: -2, bottom: -3 }}><Meta view={view} p={p} /></span>
    </div>
  );
}

function Reactions({ view, p }: { view: ChatMessageView; p: Palette }) {
  const out = view.side === "out";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5, marginBottom: 1, paddingRight: metaWidth(view) + 6 }}>
      {view.reactions.map((reaction) => {
        const mine = reaction.byMe;
        const pop = reaction.enter >= 1 ? 1 : popScale(reaction.enter);
        return (
          <span key={reaction.id} style={{ display: "inline-flex", alignItems: "center", height: 28, padding: "0 9px 0 7px", borderRadius: 14, background: mine ? (out ? p.reactionOutMine : p.reactionInMine) : (out ? p.reactionOut : p.reactionIn), transform: `scale(${pop})`, opacity: Math.min(1, reaction.enter * 3) }}>
            <span style={{ fontSize: 17, lineHeight: "20px" }}>{reaction.emoji}</span>
          </span>
        );
      })}
    </div>
  );
}

function Quote({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const reply = view.message.replyTo!;
  const out = view.side === "out";
  const fromMe = reply.direction === "outgoing";
  const name = fromMe ? model.me.name === "You" ? "You" : model.me.name : reply.sender ?? model.contact.name;
  return (
    <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", background: out ? p.quoteOut : p.quoteIn, margin: "1px -2px 5px -3px" }}>
      <span style={{ width: 3, background: out ? p.barOut : p.barIn, flexShrink: 0 }} />
      <div style={{ padding: "4px 9px 5px 7px", minWidth: 0 }}>
        <div style={{ fontSize: 14, lineHeight: "18px", fontWeight: 600, color: out ? p.barOut : p.barIn, letterSpacing: -0.15 }}>{name}</div>
        <div style={{ fontSize: 14.5, lineHeight: "19px", color: p.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: -0.2 }}>{reply.text}</div>
      </div>
    </div>
  );
}

function LinkBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const link = view.message.link;
  const out = view.side === "out";
  const text = view.message.text || link?.url || "";
  const accent = out ? p.barOut : p.barIn;
  return (
    <div style={{ width: 288 }}>
      <div style={textStyle}><Runs text={text} color={out ? p.linkOut : p.link} /></div>
      {link ? (
        <div style={{ display: "flex", borderRadius: 7, overflow: "hidden", background: out ? p.quoteOut : p.quoteIn, margin: "6px -2px 0 -3px" }}>
          <span style={{ width: 3, background: accent, flexShrink: 0 }} />
          <div style={{ padding: "6px 9px 9px 8px", minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, lineHeight: "18px", fontWeight: 600, color: accent, letterSpacing: -0.15 }}>{hostOf(link)}</div>
            {link.title ? <div style={{ fontSize: 14, lineHeight: "18px", fontWeight: 600, color: p.text, marginTop: 1, letterSpacing: -0.15 }}>{link.title}</div> : null}
            {link.image ? <img src={link.image} alt="" draggable={false} style={{ display: "block", width: "100%", aspectRatio: "1.91", objectFit: "cover", borderRadius: 6, marginTop: 7 }} /> : null}
          </div>
        </div>
      ) : null}
      {view.reactions.length ? <Reactions view={view} p={p} /> : <div style={{ height: 17 }} />}
      <span style={{ position: "absolute", right: 8, bottom: 4 }}><Meta view={view} p={p} /></span>
    </div>
  );
}

function MediaMeta({ view }: { view: ChatMessageView }) {
  return (
    <span style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(0,0,0,0.38)", borderRadius: 10, padding: "1px 6px 2px" }}>
      <Meta view={view} p={palettes.light} light />
    </span>
  );
}

function ImageBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const first = view.message.images?.[0];
  if (!first) return <TextBody view={view} p={p} />;
  const box = imageBox(first, 276);
  const caption = view.message.text.trim();
  return (
    <div style={{ width: 276 }}>
      <div style={{ position: "relative", width: box.width, height: box.height, borderRadius: 15, overflow: "hidden" }}>
        <img src={first.src} alt={first.alt} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {caption ? null : <MediaMeta view={view} />}
      </div>
      {caption ? <div style={{ padding: "5px 8px 5px 9px" }}><TextBody view={view} p={p} text={caption} /></div> : null}
    </div>
  );
}

function VideoBody({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const caption = view.message.text.trim();
  return (
    <div style={{ width: 276 }}>
      <ChatVideo message={view.message} timeMs={model.timeMs} arrivalMs={view.arrivalMs} width={276} radius={15}>
        {caption ? null : <MediaMeta view={view} />}
      </ChatVideo>
      {caption ? <div style={{ padding: "5px 8px 5px 9px" }}><TextBody view={view} p={p} text={caption} /></div> : null}
    </div>
  );
}

function AttachmentBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const out = view.side === "out";
  const accent = out ? p.reactionOutMine : p.accent;
  return (
    <div style={{ minWidth: 240 }}>
      {(view.message.attachments ?? []).map((file, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 0 6px" }}>
          <span style={{ width: 46, height: 46, borderRadius: 23, background: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden>
              <path d="M3 1.5h9l5.5 5.5v14a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 21V3A1.5 1.5 0 0 1 3 1.5z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M12 1.8V7h5.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, lineHeight: "20px", fontWeight: 600, color: p.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: -0.3 }}>{file.name}</div>
            <div style={{ fontSize: 13.5, lineHeight: "17px", color: out ? p.metaOut : p.secondary, marginTop: 2 }}>{file.size ?? "File"}</div>
          </div>
        </div>
      ))}
      {view.message.text.trim() ? <TextBody view={view} p={p} /> : <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -8 }}><Meta view={view} p={p} /></div>}
    </div>
  );
}

function AudioBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const out = view.side === "out";
  const accent = out ? p.reactionOutMine : p.accent;
  const bars = waveformBars(view.message, 34);
  const progress = view.audioProgress ?? 0;
  const audio = view.message.audio!;
  return (
    <div style={{ width: 250, display: "flex", alignItems: "center", gap: 10, position: "relative", padding: "2px 0 4px" }}>
      <span style={{ width: 44, height: 44, borderRadius: 22, background: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {view.audioPlaying
          ? <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden><path d="M2 1h4v16H2zM10 1h4v16h-4z" fill="#fff" /></svg>
          : <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden><path d="M3 1.8v16.4c0 .8.9 1.3 1.6.9l12.8-8.2c.6-.4.6-1.4 0-1.8L4.6.9C3.9.5 3 1 3 1.8z" fill="#fff" /></svg>}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 1.6, height: 22 }}>
          {bars.map((bar, index) => <span key={index} style={{ width: 2.2, height: Math.max(3, bar * 20), borderRadius: 1.2, background: accent, opacity: index / bars.length < progress ? 1 : 0.42 }} />)}
        </div>
        <div style={{ fontSize: 12.5, color: out ? p.metaOut : p.secondary, marginTop: 4 }}>{durationLabel(view.audioProgress !== undefined ? audio.duration * progress : audio.duration)}</div>
      </div>
      <span style={{ position: "absolute", right: -2, bottom: 0 }}><Meta view={view} p={p} /></span>
    </div>
  );
}

function Composer({ model, p }: { model: ChatModel; p: Palette }) {
  const text = model.draft.text;
  const typing = text.length > 0;
  return (
    <div data-slot="chat-composer" style={{ position: "relative", flexShrink: 0, background: p.bar, boxShadow: `0 -0.33px 0 ${p.hairline}`, padding: `6px 8px ${HOME_AREA_HEIGHT + 3}px 8px`, display: "flex", alignItems: "flex-end", gap: 6, zIndex: 20 }}>
      <svg width="34" height="34" viewBox="0 0 34 34" style={{ flexShrink: 0 }} aria-hidden>
        <path d="M22.3 15.6l-7.8 7.8a4.2 4.2 0 0 1-5.9-5.9l8.6-8.6a2.8 2.8 0 0 1 4 4l-8.5 8.5a1.4 1.4 0 0 1-2-2l7.7-7.7" fill="none" stroke={p.glyph} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ flex: "1 1 auto", minWidth: 0, minHeight: 34, borderRadius: 17, background: p.field, boxShadow: `inset 0 0 0 0.75px ${p.fieldBorder}`, padding: "6px 38px 6px 13px", boxSizing: "border-box", position: "relative", fontSize: 17, lineHeight: "22px", letterSpacing: -0.3 }}>
        {typing ? (
          <>
            <span style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", color: p.text }}>{text}</span>
            <Caret visible={model.draft.caret} color={p.accent} height={22} />
          </>
        ) : <span style={{ color: p.secondary }}>Message</span>}
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ position: "absolute", right: 8, bottom: 5 }} aria-hidden>
          <path d="M13.8 3.6H8.2a4.6 4.6 0 0 0-4.6 4.6v7.6a4.6 4.6 0 0 0 4.6 4.6h4.4l7.8-7.8V8.2a4.6 4.6 0 0 0-4.6-4.6z" fill="none" stroke={p.glyph} strokeWidth="1.65" strokeLinejoin="round" />
          <path d="M8.6 13.6c.8 1.2 2 1.8 3.4 1.8M9 9.4v.6M14.4 9.4v.6" fill="none" stroke={p.glyph} strokeWidth="1.65" strokeLinecap="round" />
        </svg>
      </div>
      {typing ? (
        <span style={{ width: 34, height: 34, borderRadius: 17, background: p.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden><path d="M8 16V2.5M2.3 8.2L8 2.5l5.7 5.7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      ) : (
        <svg width="34" height="34" viewBox="0 0 34 34" style={{ flexShrink: 0 }} aria-hidden>
          <rect x="13" y="7" width="8" height="14" rx="4" fill="none" stroke={p.glyph} strokeWidth="1.75" />
          <path d="M9.5 17a7.5 7.5 0 0 0 15 0M17 24.5v3" fill="none" stroke={p.glyph} strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
