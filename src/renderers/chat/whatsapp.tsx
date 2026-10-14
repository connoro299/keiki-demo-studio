import type { CSSProperties, ReactNode } from "react";
import { CHAT_MESSAGE_KINDS, durationLabel, hostOf, linkRuns, waveformBars, type ChatMessageView, type ChatModel, type ChatPerson } from "./engine";
import {
  Arrive, Avatar, BubbleTail, ChatVideo, Checks, HOME_AREA_HEIGHT, HomeIndicator, STATUS_BAR_HEIGHT, SYSTEM_FONT, StatusBar,
  WHATSAPP_GLYPHS, doodleWallpaper, imageBox, mixColor,
} from "./shared";
import { TypingDots, typingDotPose } from "./typing";

/**
 * WhatsApp for iPhone (2025-26 build): beige doodle wallpaper, light-grey bars with dark glyphs,
 * #D9FDD3 outgoing bubbles with an iOS bottom tail on the last bubble of a group, in-bubble
 * time + ticks, reaction pills hanging off the bubble, green send button.
 */

const palettes = {
  light: {
    wallpaper: "#EFEAE2",
    doodle: "rgba(120,100,72,0.13)",
    bar: "#F6F6F6",
    hairline: "rgba(0,0,0,0.16)",
    glyph: "#0A0A0A",
    text: "#111B21",
    secondary: "#667781",
    inBubble: "#FFFFFF",
    outBubble: "#D9FDD3",
    shadow: "drop-shadow(0 1px 0.5px rgba(11,20,26,0.13))",
    metaIn: "#667781",
    metaOut: "rgba(17,27,33,0.5)",
    tickGrey: "rgba(17,27,33,0.42)",
    tickBlue: "#53BDEB",
    link: "#027EB5",
    field: "#FFFFFF",
    fieldBorder: "rgba(0,0,0,0.13)",
    placeholder: "#8696A0",
    send: "#1DAA61",
    chip: "#FFFFFF",
    chipText: "#54656F",
    notice: "#FFF3C2",
    noticeText: "#54656F",
    quoteIn: "rgba(11,20,26,0.05)",
    quoteOut: "rgba(37,90,30,0.08)",
    previewIn: "#F5F6F6",
    previewOut: "#CFF3C8",
    pill: "#FFFFFF",
    statusBar: "#000000",
    home: "#000000",
    caret: "#1DAA61",
    voiceDot: "#1DAA61",
    silhouette: { bg: "#DFE5E7", fg: "#FFFFFF" },
    names: ["#D62F75", "#1F7AEC", "#C4580E", "#9C2FBF", "#00897B", "#C0392B", "#5E5CE6"],
    meName: "#1DAA61",
    contactName: "#7F66FF",
  },
  dark: {
    wallpaper: "#0B141A",
    doodle: "rgba(255,255,255,0.055)",
    bar: "#121B22",
    hairline: "rgba(255,255,255,0.09)",
    glyph: "#F2F4F5",
    text: "#E9EDEF",
    secondary: "#8696A0",
    inBubble: "#1F2C34",
    outBubble: "#144D37",
    shadow: "none",
    metaIn: "rgba(233,237,239,0.6)",
    metaOut: "rgba(233,237,239,0.6)",
    tickGrey: "rgba(233,237,239,0.6)",
    tickBlue: "#53BDEB",
    link: "#53BDEB",
    field: "#1F2C34",
    fieldBorder: "rgba(255,255,255,0.06)",
    placeholder: "#8696A0",
    send: "#21C063",
    chip: "#1D282F",
    chipText: "#8696A0",
    notice: "#1D282F",
    noticeText: "#FFD279",
    quoteIn: "rgba(255,255,255,0.06)",
    quoteOut: "rgba(0,0,0,0.16)",
    previewIn: "#18232A",
    previewOut: "#0F3E2C",
    pill: "#1F2C34",
    statusBar: "#FFFFFF",
    home: "#FFFFFF",
    caret: "#21C063",
    voiceDot: "#21C063",
    silhouette: { bg: "#6A7175", fg: "#C8CDD0" },
    names: ["#FF72A1", "#53A6FD", "#FFB255", "#D88BFF", "#4DD0C2", "#FF7B6B", "#A29BFE"],
    meName: "#06CF9C",
    contactName: "#A79BFF",
  },
};

type Palette = typeof palettes.light;

const HEADER_HEIGHT = 52;

export function WhatsAppScreen({ model }: { model: ChatModel }) {
  const p = palettes[model.theme];
  const wallpaper = doodleWallpaper({ stroke: p.doodle, names: WHATSAPP_GLYPHS, tile: 280, count: 36, seed: 11, strokeWidth: 1.45 });
  return (
    <div data-skin="whatsapp" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: p.wallpaper, backgroundImage: wallpaper, backgroundSize: "280px 280px", fontFamily: SYSTEM_FONT, color: p.text, WebkitFontSmoothing: "antialiased" }}>
      <Header model={model} p={p} />
      <div data-slot="chat-thread" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", paddingTop: STATUS_BAR_HEIGHT + HEADER_HEIGHT + 8, paddingBottom: 8, boxSizing: "border-box", flexShrink: 0 }}>
          <Notice p={p} />
          <DayChip p={p} label={model.dayLabel} />
          {model.messages.map((view) => (
            <Arrive key={view.id} id={view.id} enter={view.enter} origin={view.side === "out" ? "bottom right" : "bottom left"}>
              <MessageRow view={view} model={model} p={p} />
            </Arrive>
          ))}
          {model.typing.visible ? (
            <Arrive id="typing" enter={model.typing.enter}>
              <TypingRow model={model} p={p} />
            </Arrive>
          ) : null}
          <div style={{ flex: "1 1 auto" }} />
        </div>
      </div>
      <Composer model={model} p={p} />
      <StatusBar time={model.statusTime} color={p.statusBar} />
      <HomeIndicator color={p.home} />
    </div>
  );
}

function Header({ model, p }: { model: ChatModel; p: Palette }) {
  const subtitle = model.typing.visible
    ? model.group ? `${model.typing.who.name.split(" ")[0]} is typing…` : "typing…"
    : model.group ? [...model.participants.map((person) => person.name.split(" ")[0]), "You"].join(", ") : "online";
  const title = model.group ? model.groupName ?? model.contact.name : model.contact.name;
  return (
    <div data-slot="chat-header" style={{ position: "absolute", left: 0, top: 0, right: 0, height: STATUS_BAR_HEIGHT + HEADER_HEIGHT, background: p.bar, boxShadow: `0 0.5px 0 ${p.hairline}`, zIndex: 30 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: STATUS_BAR_HEIGHT, height: HEADER_HEIGHT, display: "flex", alignItems: "center" }}>
        <svg width="13" height="21" viewBox="0 0 13 21" style={{ marginLeft: 14, flexShrink: 0 }} aria-hidden>
          <path d="M11 1.8L2.6 10.5 11 19.2" fill="none" stroke={p.glyph} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ marginLeft: 12 }}>
          <Avatar person={model.contact} size={36} fallback="silhouette" silhouetteColors={p.silhouette} />
        </div>
        <div style={{ marginLeft: 10, minWidth: 0, flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 17, lineHeight: "21px", fontWeight: 600, letterSpacing: -0.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: p.text }}>{title}</div>
          <div style={{ fontSize: 12.5, lineHeight: "16px", color: p.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: -0.05 }}>{subtitle}</div>
        </div>
        <svg width="26" height="26" viewBox="0 0 26 26" style={{ flexShrink: 0, marginLeft: 8 }} aria-hidden>
          <rect x="1.6" y="6.4" width="15.8" height="13.2" rx="3.4" fill="none" stroke={p.glyph} strokeWidth="1.75" />
          <path d="M17.4 11.4l5.3-3.3c.6-.4 1.3.1 1.3.8v8.2c0 .7-.7 1.2-1.3.8l-5.3-3.3z" fill="none" stroke={p.glyph} strokeWidth="1.75" strokeLinejoin="round" />
        </svg>
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink: 0, marginLeft: 24, marginRight: 18 }} aria-hidden>
          <path d="M6.3 2.9c.7-.5 1.6-.3 2.1.3l2.2 2.9c.5.6.4 1.5-.1 2.1L9.3 9.5c1 2.1 2.7 3.8 4.8 4.8l1.3-1.2c.6-.5 1.5-.6 2.1-.1l2.9 2.2c.7.5.8 1.4.3 2.1l-1.1 1.7c-.7 1-1.9 1.5-3.1 1.2C10 19 4.9 13.9 3.7 7.7c-.3-1.2.2-2.4 1.2-3.1z" fill="none" stroke={p.glyph} strokeWidth="1.75" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function Notice({ p }: { p: Palette }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "6px 30px 2px" }}>
      <div style={{ background: p.notice, color: p.noticeText, borderRadius: 9, padding: "7px 12px 8px", fontSize: 12.5, lineHeight: "16.5px", textAlign: "center", letterSpacing: -0.05, maxWidth: 312, boxShadow: p === palettes.light ? "0 1px 0.5px rgba(11,20,26,0.1)" : undefined }}>
        <svg width="9" height="11" viewBox="0 0 9 11" style={{ display: "inline-block", marginRight: 4, verticalAlign: -1 }} aria-hidden>
          <path d="M1.6 4.7V3.4a2.9 2.9 0 0 1 5.8 0v1.3M1 4.7h7c.4 0 .7.3.7.7v4.1c0 .4-.3.7-.7.7H1c-.4 0-.7-.3-.7-.7V5.4c0-.4.3-.7.7-.7z" fill="none" stroke={p.noticeText} strokeWidth="1.1" />
        </svg>
        Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them. <span style={{ fontWeight: 600 }}>Learn more</span>
      </div>
    </div>
  );
}

function DayChip({ p, label }: { p: Palette; label: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px" }}>
      <div style={{ background: p.chip, color: p.chipText, borderRadius: 8, padding: "4px 11px 5px", fontSize: 12.5, lineHeight: "16px", fontWeight: 500, boxShadow: p === palettes.light ? "0 1px 0.5px rgba(11,20,26,0.13)" : undefined }}>{label}</div>
    </div>
  );
}

function nameColor(person: ChatPerson, p: Palette): string {
  if (person.me) return p.meName;
  if (person.contact) return p.contactName;
  return p.names[person.colorIndex % p.names.length];
}

function MessageRow({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const out = view.side === "out";
  const showAvatar = model.group && !out;
  const marginTop = view.firstOfGroup ? 8 : 2;
  const hasReactions = view.reactions.length > 0;
  return (
    <div data-message-id={view.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start", alignItems: "flex-end", padding: out ? "0 16px 0 60px" : showAvatar ? "0 60px 0 8px" : "0 60px 0 16px", marginTop, marginBottom: hasReactions ? 17 : 0 }}>
      {showAvatar ? (
        <div style={{ width: 28, marginRight: 6, flexShrink: 0, alignSelf: "flex-end" }}>
          {view.lastOfGroup ? <Avatar person={view.sender} size={28} fallback="silhouette" silhouetteColors={p.silhouette} /> : null}
        </div>
      ) : null}
      {view.emojiOnly ? <EmojiOnly view={view} p={p} /> : <Bubble view={view} model={model} p={p} />}
    </div>
  );
}

function EmojiOnly({ view, p }: { view: ChatMessageView; p: Palette }) {
  const out = view.side === "out";
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: out ? "flex-end" : "flex-start" }}>
      <div style={{ fontSize: 50, lineHeight: "58px" }}>{view.message.text.trim()}</div>
      <div style={{ background: out ? p.outBubble : p.inBubble, borderRadius: 9, padding: "1px 6px", marginTop: 2, filter: p.shadow }}>
        <Meta view={view} p={p} />
      </div>
      <Reactions view={view} p={p} />
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
  const tail = view.lastOfGroup;
  const radius: CSSProperties = {
    borderRadius: 18,
    ...(tail ? (out ? { borderBottomRightRadius: 0 } : { borderBottomLeftRadius: 0 }) : {}),
  };
  const showName = model.group && !out && view.firstOfGroup;
  return (
    <div style={{ position: "relative", filter: p.shadow, maxWidth: media ? 276 : 324, minWidth: 0 }}>
      <div style={{ position: "relative", background: color, ...radius, padding: media ? 3 : kind === "audio" ? "6px 8px 6px 6px" : "6px 9px 7px 10px", overflow: "hidden" }}>
        {showName ? <div style={{ fontSize: 13.5, lineHeight: "18px", fontWeight: 600, color: nameColor(view.sender, p), padding: media ? "3px 6px 3px" : "0 0 1px", letterSpacing: -0.1 }}>{view.sender.name}</div> : null}
        {message.replyTo ? <Quote view={view} model={model} p={p} inset={media} /> : null}
        {!native ? <TextBody view={view} p={p} /> : null}
        {kind === "text" ? <TextBody view={view} p={p} /> : null}
        {kind === "link" ? <LinkBody view={view} p={p} /> : null}
        {kind === "image" ? <ImageBody view={view} p={p} /> : null}
        {kind === "video" ? <VideoBody view={view} model={model} p={p} /> : null}
        {kind === "attachment" ? <AttachmentBody view={view} p={p} /> : null}
        {kind === "audio" ? <AudioBody view={view} p={p} /> : null}
      </div>
      {tail ? <BubbleTail side={view.side} color={color} /> : null}
      <Reactions view={view} p={p} />
    </div>
  );
}

function metaWidth(view: ChatMessageView): number {
  const time = view.time.length * 6.2 + 2;
  const edited = view.message.edited ? 38 : 0;
  return Math.round(time + edited + (view.side === "out" ? 21 : 0));
}

function Meta({ view, p, overlay = false }: { view: ChatMessageView; p: Palette; overlay?: boolean }) {
  const out = view.side === "out";
  const color = overlay ? "rgba(255,255,255,0.95)" : out ? p.metaOut : p.metaIn;
  const read = view.status === "read";
  const double = view.status === "delivered" || read;
  const previousBlue = view.previousStatus === "read";
  const tickColor = overlay
    ? read ? mixColor("#FFFFFF", p.tickBlue, view.statusChange) : "#FFFFFF"
    : read ? mixColor(previousBlue ? p.tickBlue : p.tickGrey, p.tickBlue, view.statusChange) : p.tickGrey;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, lineHeight: "15px", color, whiteSpace: "nowrap", letterSpacing: 0.05, fontVariantNumeric: "tabular-nums" }}>
      {view.message.edited ? <span>Edited</span> : null}
      <span>{view.time}</span>
      {out && view.status && view.status !== "failed" ? (
        view.status === "sending" ? (
          <svg width="14" height="11" viewBox="0 0 14 11" aria-hidden><circle cx="7" cy="5.5" r="4.3" fill="none" stroke={tickColor} strokeWidth="1.2" /><path d="M7 3v2.7l1.8 1" fill="none" stroke={tickColor} strokeWidth="1.2" strokeLinecap="round" /></svg>
        ) : (
          <Checks double={double} color={tickColor} width={17} height={11.5} style={{ marginLeft: 1 }} />
        )
      ) : null}
    </span>
  );
}

function Runs({ text, p }: { text: string; p: Palette }) {
  return (
    <>
      {linkRuns(text).map((run, index) => run.url
        ? <span key={index} style={{ color: p.link, textDecoration: "underline", textDecorationThickness: 1, textUnderlineOffset: 2 }}>{run.text}</span>
        : <span key={index}>{run.text}</span>)}
    </>
  );
}

const textStyle: CSSProperties = { fontSize: 17, lineHeight: "22px", letterSpacing: -0.25, whiteSpace: "pre-wrap", overflowWrap: "break-word" };

function TextBody({ view, p, text }: { view: ChatMessageView; p: Palette; text?: string }) {
  const value = text ?? view.message.text;
  return (
    <div style={{ position: "relative" }}>
      <div style={textStyle}>
        <Runs text={value} p={p} />
        <span style={{ display: "inline-block", width: metaWidth(view) + 4, height: 1 }} />
      </div>
      <span style={{ position: "absolute", right: -1, bottom: -3 }}><Meta view={view} p={p} /></span>
    </div>
  );
}

function Quote({ view, model, p, inset }: { view: ChatMessageView; model: ChatModel; p: Palette; inset: boolean }) {
  const reply = view.message.replyTo!;
  const fromMe = reply.direction === "outgoing";
  const sender = fromMe ? model.me : reply.sender ? { ...model.contact, name: reply.sender, contact: reply.sender === model.contact.name } : model.contact;
  const color = fromMe ? p.meName : nameColor(sender, p);
  return (
    <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", background: view.side === "out" ? p.quoteOut : p.quoteIn, margin: inset ? "0 0 3px" : "1px -3px 5px -4px", minWidth: 180 }}>
      <span style={{ width: 4, background: color, flexShrink: 0 }} />
      <div style={{ padding: "5px 10px 6px 8px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: "17px", fontWeight: 600, color }}>{fromMe ? "You" : sender.name}</div>
        <div style={{ fontSize: 13.5, lineHeight: "18px", color: p.secondary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{reply.text}</div>
      </div>
    </div>
  );
}

function LinkBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const link = view.message.link;
  const out = view.side === "out";
  const text = view.message.text || link?.url || "";
  return (
    <div style={{ width: 286 }}>
      {link ? (
        <div style={{ background: out ? p.previewOut : p.previewIn, borderRadius: 9, overflow: "hidden", margin: "-2px -5px 6px -6px" }}>
          {link.image ? <img src={link.image} alt="" draggable={false} style={{ display: "block", width: "100%", aspectRatio: "1.91", objectFit: "cover" }} /> : null}
          <div style={{ padding: "8px 11px 9px" }}>
            {link.title ? <div style={{ fontSize: 14.5, lineHeight: "19px", fontWeight: 600, color: p.text, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", letterSpacing: -0.15 }}>{link.title}</div> : null}
            <div style={{ fontSize: 13, lineHeight: "17px", color: p.secondary, marginTop: 2 }}>{hostOf(link)}</div>
          </div>
        </div>
      ) : null}
      <TextBody view={view} p={p} text={text} />
    </div>
  );
}

function MediaMetaOverlay({ view, p }: { view: ChatMessageView; p: Palette }) {
  return (
    <div style={{ position: "absolute", right: 0, bottom: 0, left: 0, height: 34, background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.32) 100%)", display: "flex", justifyContent: "flex-end", alignItems: "flex-end", padding: "0 8px 5px" }}>
      <Meta view={view} p={p} overlay />
    </div>
  );
}

function ImageBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const images = view.message.images ?? [];
  const caption = view.message.text.trim();
  const first = images[0];
  if (!first) return <TextBody view={view} p={p} />;
  const box = imageBox(first, 270);
  return (
    <div style={{ width: 270 }}>
      <div style={{ position: "relative", borderRadius: 15, overflow: "hidden", width: box.width, height: box.height, background: "rgba(0,0,0,0.08)" }}>
        <img src={first.src} alt={first.alt} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {images.length > 1 ? <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 28, fontWeight: 500 }}>+{images.length - 1}</div> : null}
        {caption ? null : <MediaMetaOverlay view={view} p={p} />}
      </div>
      {caption ? <div style={{ padding: "5px 6px 4px 7px" }}><TextBody view={view} p={p} text={caption} /></div> : null}
    </div>
  );
}

function VideoBody({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const caption = view.message.text.trim();
  return (
    <div style={{ width: 270 }}>
      <ChatVideo message={view.message} timeMs={model.timeMs} arrivalMs={view.arrivalMs} width={270} radius={15}>
        <div style={{ position: "absolute", left: 8, bottom: 6, display: "flex", alignItems: "center", gap: 4, color: "#fff", fontSize: 11.5, textShadow: "0 0 3px rgba(0,0,0,0.4)" }}>
          <svg width="16" height="11" viewBox="0 0 16 11" aria-hidden><rect x="0.6" y="0.8" width="10" height="9.4" rx="2" fill="#fff" /><path d="M11.4 4l3.6-2.2v7.4L11.4 7z" fill="#fff" /></svg>
        </div>
        {caption ? null : <MediaMetaOverlay view={view} p={p} />}
      </ChatVideo>
      {caption ? <div style={{ padding: "5px 6px 4px 7px" }}><TextBody view={view} p={p} text={caption} /></div> : null}
    </div>
  );
}

function AttachmentBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const out = view.side === "out";
  const files = view.message.attachments ?? [];
  return (
    <div style={{ width: 268 }}>
      {files.map((file, index) => {
        const extension = (file.name.split(".").pop() ?? "file").toUpperCase().slice(0, 4);
        return (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 10, background: out ? p.previewOut : p.previewIn, borderRadius: 9, padding: "10px 10px", margin: "-1px -4px 6px -5px" }}>
            <FileTile extension={extension} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, lineHeight: "19px", color: p.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: -0.2 }}>{file.name}</div>
              <div style={{ fontSize: 12.5, lineHeight: "16px", color: p.secondary, marginTop: 1 }}>{[file.size, extension].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
        );
      })}
      {view.message.text.trim() ? <TextBody view={view} p={p} /> : <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -2 }}><Meta view={view} p={p} /></div>}
    </div>
  );
}

export function FileTile({ extension }: { extension: string }) {
  const color = extension === "PDF" ? "#E5252A" : extension.startsWith("XLS") || extension === "CSV" ? "#1D7044" : extension.startsWith("DOC") ? "#2B579A" : "#7A8B99";
  return (
    <svg width="30" height="38" viewBox="0 0 30 38" style={{ flexShrink: 0 }} aria-hidden>
      <path d="M4 0h15l11 11v23a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill={color} />
      <path d="M19 0l11 11h-7a4 4 0 0 1-4-4z" fill="rgba(255,255,255,0.45)" />
      <text x="15" y="30" textAnchor="middle" fontFamily={SYSTEM_FONT} fontSize="7.5" fontWeight="700" fill="#fff">{extension}</text>
    </svg>
  );
}

function AudioBody({ view, p }: { view: ChatMessageView; p: Palette }) {
  const out = view.side === "out";
  const audio = view.message.audio!;
  const bars = waveformBars(view.message, 30);
  const progress = view.audioProgress ?? 0;
  const played = out ? p.tickGrey : p.secondary;
  return (
    <div style={{ width: 266, display: "flex", alignItems: "center", gap: 6, position: "relative", paddingBottom: 12 }}>
      {out ? null : null}
      <svg width="30" height="30" viewBox="0 0 30 30" style={{ flexShrink: 0, marginLeft: 2 }} aria-hidden>
        {view.audioPlaying ? <path d="M9 7h4v16H9zM17 7h4v16h-4z" fill={p.secondary} /> : <path d="M9 6.3v17.4c0 .8.9 1.3 1.6.9l14-8.7c.6-.4.6-1.4 0-1.8l-14-8.7C9.9 5 9 5.5 9 6.3z" fill={p.secondary} />}
      </svg>
      <div style={{ position: "relative", flex: 1, height: 30, display: "flex", alignItems: "center", gap: 2 }}>
        {bars.map((bar, index) => (
          <span key={index} style={{ width: 2.6, height: Math.max(3, bar * 22), borderRadius: 2, background: index / bars.length < progress ? (out ? "#53BDEB" : p.voiceDot) : played, opacity: index / bars.length < progress ? 1 : 0.55 }} />
        ))}
        <span style={{ position: "absolute", left: `calc(${progress * 100}% - 6px)`, top: 9, width: 12, height: 12, borderRadius: 6, background: out ? "#53BDEB" : p.voiceDot }} />
      </div>
      <div style={{ position: "relative", flexShrink: 0, marginLeft: 6 }}>
        <Avatar person={view.sender} size={44} fallback="silhouette" silhouetteColors={p.silhouette} />
        <svg width="18" height="18" viewBox="0 0 18 18" style={{ position: "absolute", left: -6, bottom: -2 }} aria-hidden>
          <path d="M9 2.6a2.3 2.3 0 0 1 2.3 2.3v4.2a2.3 2.3 0 0 1-4.6 0V4.9A2.3 2.3 0 0 1 9 2.6zM4.6 8.6a4.4 4.4 0 0 0 8.8 0M9 13v2.4" fill="none" stroke={out ? "#53BDEB" : p.voiceDot} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </div>
      <span style={{ position: "absolute", left: 40, bottom: -3, fontSize: 11.5, color: out ? p.metaOut : p.metaIn }}>{durationLabel(view.audioProgress !== undefined ? audio.duration * progress : audio.duration)}</span>
      <span style={{ position: "absolute", right: 56, bottom: -3 }}><Meta view={view} p={p} /></span>
    </div>
  );
}

function Reactions({ view, p }: { view: ChatMessageView; p: Palette }) {
  if (view.reactions.length === 0) return null;
  const emojis = [...new Map(view.reactions.map((reaction) => [reaction.emoji, reaction])).values()];
  const count = view.reactions.length;
  const enter = Math.min(...view.reactions.map((reaction) => reaction.enter));
  const pop = enter >= 1 ? 1 : popScale(enter);
  return (
    <div style={{ position: "absolute", left: view.side === "out" ? undefined : 10, right: view.side === "out" ? 12 : undefined, bottom: -19, display: "flex", alignItems: "center", gap: 2, background: p.pill, borderRadius: 14, padding: "2px 6px", height: 22, boxShadow: `0 0 0 2px ${p.wallpaper}, 0 1px 2px rgba(11,20,26,0.16)`, transform: `scale(${pop})`, transformOrigin: "center", opacity: Math.min(1, enter * 3), zIndex: 2 }}>
      {emojis.map((reaction) => <span key={reaction.id} style={{ fontSize: 14.5, lineHeight: "18px" }}>{reaction.emoji}</span>)}
      {count > 1 ? <span style={{ fontSize: 12.5, color: p.secondary, marginLeft: 1 }}>{count}</span> : null}
    </div>
  );
}

export function popScale(enter: number): number {
  if (enter <= 0) return 0.2;
  if (enter < 0.55) return 0.2 + (1.18 - 0.2) * (enter / 0.55);
  return 1.18 - 0.18 * ((enter - 0.55) / 0.45);
}

function TypingRow({ model, p }: { model: ChatModel; p: Palette }) {
  const showAvatar = model.group;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", padding: showAvatar ? "0 60px 0 8px" : "0 60px 0 16px", marginTop: 8 }}>
      {showAvatar ? <div style={{ width: 28, marginRight: 6 }}><Avatar person={model.typing.who} size={28} fallback="silhouette" silhouetteColors={p.silhouette} /></div> : null}
      <div style={{ position: "relative", filter: p.shadow }}>
        <div style={{ background: p.inBubble, borderRadius: 18, borderBottomLeftRadius: 0, height: 36, width: 62, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <TypingDots elapsed={model.typing.elapsed} color={p.secondary} size={7.5} gap={4.5} />
        </div>
        <BubbleTail side="in" color={p.inBubble} />
      </div>
    </div>
  );
}

function Composer({ model, p }: { model: ChatModel; p: Palette }) {
  const text = model.draft.text;
  const typing = text.length > 0;
  return (
    <div data-slot="chat-composer" style={{ position: "relative", flexShrink: 0, background: p.bar, boxShadow: `0 -0.5px 0 ${p.hairline}`, padding: `7px 12px ${HOME_AREA_HEIGHT + 2}px 10px`, display: "flex", alignItems: "flex-end", gap: 10, zIndex: 20 }}>
      <svg width="30" height="36" viewBox="0 0 30 36" style={{ flexShrink: 0 }} aria-hidden>
        <path d="M15 8.5v19M5.5 18h19" stroke={p.glyph} strokeWidth="1.9" strokeLinecap="round" />
      </svg>
      <div style={{ flex: "1 1 auto", minWidth: 0, minHeight: 36, borderRadius: 18, background: p.field, boxShadow: `inset 0 0 0 0.75px ${p.fieldBorder}`, padding: "7px 40px 7px 13px", boxSizing: "border-box", position: "relative", fontSize: 17, lineHeight: "22px", letterSpacing: -0.25, color: p.text }}>
        <span style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>{text}</span>
        {typing ? <Caret visible={model.draft.caret} color={p.caret} height={22} /> : null}
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ position: "absolute", right: 9, bottom: 6 }} aria-hidden>
          <path d="M14.6 3.5H7.6A4.1 4.1 0 0 0 3.5 7.6v8.8a4.1 4.1 0 0 0 4.1 4.1h5.2l7.7-7.7V7.6a4.1 4.1 0 0 0-4.1-4.1z" fill="none" stroke={p.glyph} strokeWidth="1.65" strokeLinejoin="round" />
          <path d="M12.8 20.4v-3.2a4.4 4.4 0 0 1 4.4-4.4h3.3" fill="none" stroke={p.glyph} strokeWidth="1.65" strokeLinejoin="round" />
        </svg>
      </div>
      {typing ? (
        <div style={{ width: 36, height: 36, borderRadius: 18, background: p.send, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <path d="M3.2 3.6l14 6c.5.2.5.9 0 1.1l-14 6c-.5.2-1-.3-.8-.8L4.6 10 2.4 4.4c-.2-.5.3-1 .8-.8zM4.6 10h6.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
      ) : (
        <>
          <svg width="27" height="36" viewBox="0 0 27 36" style={{ flexShrink: 0, marginLeft: 2 }} aria-hidden>
            <path d="M2.5 13.6a2.6 2.6 0 0 1 2.6-2.6h2.6l1.8-2.4h8l1.8 2.4h2.6a2.6 2.6 0 0 1 2.6 2.6v10.2a2.6 2.6 0 0 1-2.6 2.6H5.1a2.6 2.6 0 0 1-2.6-2.6z" fill="none" stroke={p.glyph} strokeWidth="1.75" strokeLinejoin="round" />
            <circle cx="13.5" cy="18.6" r="4.1" fill="none" stroke={p.glyph} strokeWidth="1.75" />
          </svg>
          <svg width="22" height="36" viewBox="0 0 22 36" style={{ flexShrink: 0, marginLeft: 8, marginRight: 2 }} aria-hidden>
            <rect x="7" y="7.5" width="8" height="14" rx="4" fill="none" stroke={p.glyph} strokeWidth="1.75" />
            <path d="M3.5 17.5a7.5 7.5 0 0 0 15 0M11 25v3.5" fill="none" stroke={p.glyph} strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </>
      )}
    </div>
  );
}

export function Caret({ visible, color, height }: { visible: boolean; color: string; height: number }): ReactNode {
  return <span aria-hidden style={{ display: "inline-block", width: 2, height: height - 2, marginLeft: 1, marginBottom: -4, borderRadius: 1, background: color, opacity: visible ? 1 : 0, verticalAlign: "baseline" }} />;
}

export { typingDotPose };
