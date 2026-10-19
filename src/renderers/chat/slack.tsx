import { Fragment } from "react";
import type { CSSProperties } from "react";
import { CHAT_MESSAGE_KINDS, durationLabel, hostOf, linkRuns, waveformBars, type ChatMessageView, type ChatModel, type ChatPerson } from "./engine";
import { Arrive, Avatar, ChatVideo, DISPLAY_FONT, HOME_AREA_HEIGHT, HomeIndicator, STATUS_BAR_HEIGHT, SYSTEM_FONT, StatusBar, imageBox } from "./shared";
import { Caret, FileTile, popScale } from "./whatsapp";

/**
 * Slack for iPhone: no bubbles. Rounded-square avatars, bold names with an APP badge on the agent,
 * messages grouped by sender, emoji chips with counts, unfurls with a left rule, "is typing…" above
 * a "Message <name>" composer.
 */

const palettes = {
  light: {
    bg: "#FFFFFF",
    text: "#1D1C1D",
    secondary: "#616061",
    faint: "#868686",
    border: "#E2E2E2",
    link: "#1264A3",
    badgeBg: "rgba(29,28,29,0.08)",
    badgeText: "#616061",
    chip: "rgba(29,28,29,0.06)",
    chipMine: "rgba(29,155,209,0.1)",
    chipMineBorder: "#1D9BD1",
    chipMineText: "#1264A3",
    rule: "#DDDDDD",
    field: "#FFFFFF",
    plusBg: "rgba(29,28,29,0.06)",
    glyph: "#616061",
    send: "#007A5A",
    presence: "#2BAC76",
    statusBar: "#000000",
    home: "#000000",
    caret: "#1264A3",
    file: "#F8F8F8",
  },
  dark: {
    bg: "#1A1D21",
    text: "#D1D2D3",
    secondary: "#ABABAD",
    faint: "#9A9B9E",
    border: "#35373B",
    link: "#1D9BD1",
    badgeBg: "rgba(232,232,232,0.1)",
    badgeText: "#ABABAD",
    chip: "rgba(232,232,232,0.08)",
    chipMine: "rgba(29,155,209,0.18)",
    chipMineBorder: "#1D9BD1",
    chipMineText: "#1D9BD1",
    rule: "#4A4D52",
    field: "#1A1D21",
    plusBg: "rgba(232,232,232,0.1)",
    glyph: "#ABABAD",
    send: "#007A5A",
    presence: "#2BAC76",
    statusBar: "#FFFFFF",
    home: "#FFFFFF",
    caret: "#1D9BD1",
    file: "#222529",
  },
};

type Palette = typeof palettes.light;
const HEADER_HEIGHT = 50;
const TABS_HEIGHT = 40;
const SLACK_AVATAR_COLORS = ["#E01E5A", "#2EB67D", "#ECB22E", "#36C5F0", "#4A154B", "#1264A3", "#E8912D"];

function slackAvatar(person: ChatPerson, size: number) {
  return <Avatar person={person} size={size} radius={Math.round(size * 0.22)} background={SLACK_AVATAR_COLORS[person.colorIndex % SLACK_AVATAR_COLORS.length]} fontScale={0.38} />;
}

/** The agent (the conversation's contact) is a Slack app. */
const isApp = (person: ChatPerson) => person.contact;

export function SlackScreen({ model }: { model: ChatModel }) {
  const p = palettes[model.theme];
  return (
    <div data-skin="slack" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: p.bg, fontFamily: SYSTEM_FONT, color: p.text, WebkitFontSmoothing: "antialiased" }}>
      <Header model={model} p={p} />
      <div data-slot="chat-thread" style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", paddingTop: STATUS_BAR_HEIGHT + HEADER_HEIGHT + TABS_HEIGHT, paddingBottom: 10, boxSizing: "border-box", flexShrink: 0 }}>
          <Intro model={model} p={p} />
          <DayDivider p={p} label={model.dayLabel} />
          {model.messages.map((view) => (
            <Fragment key={view.id}>
              {view.dayLabel ? <DayDivider p={p} label={view.dayLabel} /> : null}
              <Arrive key={view.id} id={view.id} enter={view.enter} rise={8} scale={1} origin="top left">
                <MessageRow view={view} model={model} p={p} />
              </Arrive>
            </Fragment>
          ))}
          <div style={{ flex: "1 1 auto" }} />
        </div>
      </div>
      <TypingLine model={model} p={p} />
      <Composer model={model} p={p} />
      <StatusBar time={model.statusTime} color={p.statusBar} />
      <HomeIndicator color={p.home} />
    </div>
  );
}

function Header({ model, p }: { model: ChatModel; p: Palette }) {
  const title = model.group ? `# ${model.groupName ?? model.contact.name}` : model.contact.name;
  return (
    <div data-slot="chat-header" style={{ position: "absolute", left: 0, right: 0, top: 0, height: STATUS_BAR_HEIGHT + HEADER_HEIGHT + TABS_HEIGHT, background: p.bg, boxShadow: `0 1px 0 ${p.border}`, zIndex: 30 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: STATUS_BAR_HEIGHT, height: HEADER_HEIGHT, display: "flex", alignItems: "center" }}>
        <svg width="13" height="21" viewBox="0 0 13 21" style={{ marginLeft: 16, flexShrink: 0 }} aria-hidden>
          <path d="M11 1.8L2.6 10.5 11 19.2" fill="none" stroke={p.text} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {model.group ? null : (
          <div style={{ position: "relative", marginLeft: 16 }}>
            {slackAvatar(model.contact, 28)}
            <span style={{ position: "absolute", right: -3, bottom: -3, width: 9, height: 9, borderRadius: 5, background: p.presence, boxShadow: `0 0 0 2px ${p.bg}` }} />
          </div>
        )}
        <div style={{ marginLeft: 10, display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ fontFamily: DISPLAY_FONT, fontSize: 17.5, fontWeight: 700, letterSpacing: -0.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          <svg width="8" height="13" viewBox="0 0 8 13" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden><path d="M1.5 1.5l5 5-5 5" fill="none" stroke={p.secondary} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ marginRight: 18, flexShrink: 0 }} aria-hidden>
          <path d="M4 15.5v-3.2a8 8 0 0 1 16 0v3.2" fill="none" stroke={p.text} strokeWidth="1.8" strokeLinecap="round" />
          <rect x="3" y="14" width="4.5" height="6.5" rx="1.8" fill="none" stroke={p.text} strokeWidth="1.8" />
          <rect x="16.5" y="14" width="4.5" height="6.5" rx="1.8" fill="none" stroke={p.text} strokeWidth="1.8" />
        </svg>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: STATUS_BAR_HEIGHT + HEADER_HEIGHT, height: TABS_HEIGHT, display: "flex", alignItems: "stretch", gap: 22, padding: "0 16px", fontSize: 14.5, fontWeight: 600 }}>
        <Tab label="Messages" active p={p} icon={<path d="M3.5 4.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4.5 3.5v-12.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />} />
        <Tab label="Add canvas" p={p} icon={<path d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 11h5M10.5 8.5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />} />
        <Tab label="Files" p={p} icon={<path d="M3 6a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />} />
      </div>
    </div>
  );
}

function Tab({ label, active = false, p, icon }: { label: string; active?: boolean; p: Palette; icon: React.ReactNode }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, color: active ? p.text : p.secondary }}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>{icon}</svg>
      <span>{label}</span>
      {active ? <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, borderRadius: "2px 2px 0 0", background: p.text }} /> : null}
    </div>
  );
}

function AppBadge({ p }: { p: Palette }) {
  return <span style={{ display: "inline-block", fontSize: 10, lineHeight: "14px", fontWeight: 700, letterSpacing: 0.3, color: p.badgeText, background: p.badgeBg, borderRadius: 3, padding: "0 3.5px", verticalAlign: 2 }}>APP</span>;
}

function Intro({ model, p }: { model: ChatModel; p: Palette }) {
  if (model.group) return null;
  return (
    <div style={{ padding: "18px 16px 6px" }}>
      {slackAvatar(model.contact, 64)}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12 }}>
        <span style={{ fontFamily: DISPLAY_FONT, fontSize: 21, fontWeight: 800, letterSpacing: -0.4 }}>{model.contact.name}</span>
        <AppBadge p={p} />
      </div>
      <div style={{ fontSize: 15, lineHeight: "21px", color: p.secondary, marginTop: 6, letterSpacing: -0.1 }}>
        This is the very beginning of your direct message history with <span style={{ color: p.link, background: model.theme === "dark" ? "rgba(29,155,209,0.1)" : "rgba(29,155,209,0.1)", borderRadius: 3, padding: "0 2px" }}>@{model.contact.name}</span>.
      </div>
    </div>
  );
}

function DayDivider({ p, label }: { p: Palette; label: string }) {
  return (
    <div style={{ position: "relative", height: 26, margin: "14px 0 4px", display: "flex", justifyContent: "center", alignItems: "center", flexShrink: 0 }}>
      <span style={{ position: "absolute", left: 0, right: 0, top: 13, height: 1, background: p.border }} />
      <span style={{ position: "relative", background: p.bg, border: `1px solid ${p.border}`, borderRadius: 13, padding: "3px 10px 3px 12px", fontSize: 13, fontWeight: 700, color: p.text, display: "flex", alignItems: "center", gap: 4, letterSpacing: -0.1 }}>
        {label}
        <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden><path d="M1 1l3.5 3.5L8 1" fill="none" stroke={p.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    </div>
  );
}

const bodyText: CSSProperties = { fontSize: 16, lineHeight: "23px", letterSpacing: -0.2, whiteSpace: "pre-wrap", overflowWrap: "break-word" };

function MessageRow({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const continued = !view.firstOfGroup;
  return (
    <div data-message-id={view.id} style={{ display: "flex", padding: continued ? "2px 16px 2px 16px" : "10px 16px 2px 16px", gap: 10 }}>
      <div style={{ width: 38, flexShrink: 0 }}>{continued ? null : slackAvatar(view.sender, 38)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        {continued ? null : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, lineHeight: "20px", marginBottom: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.25, color: p.text }}>{view.sender.name}</span>
            {isApp(view.sender) ? <AppBadge p={p} /> : null}
            <span style={{ fontSize: 12.5, color: p.secondary }}>{view.time}</span>
          </div>
        )}
        <Body view={view} model={model} p={p} />
        <Chips view={view} p={p} />
      </div>
    </div>
  );
}

function Runs({ text, p }: { text: string; p: Palette }) {
  return <>{linkRuns(text).map((run, index) => run.url ? <span key={index} style={{ color: p.link }}>{run.text}</span> : <span key={index}>{run.text}</span>)}</>;
}

function Body({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const message = view.message;
  const kind = message.kind ?? (message.images?.length ? "image" : message.link ? "link" : "text");
  const native = CHAT_MESSAGE_KINDS.has(kind);
  const text = message.text.trim();
  return (
    <>
      {message.replyTo ? <Quote view={view} model={model} p={p} /> : null}
      {text || !native || kind === "text" ? (
        <div style={{ ...bodyText, fontSize: view.emojiOnly ? 32 : 16, lineHeight: view.emojiOnly ? "40px" : "23px", color: p.text }}>
          <Runs text={message.text} p={p} />
          {message.edited ? <span style={{ fontSize: 13, color: p.secondary }}> (edited)</span> : null}
        </div>
      ) : null}
      {kind === "link" && message.link ? <Unfurl link={message.link} p={p} /> : null}
      {kind === "image" && message.images?.[0] ? (
        <img src={message.images[0].src} alt={message.images[0].alt} draggable={false} style={{ display: "block", ...imageBox(message.images[0], 260), objectFit: "cover", borderRadius: 8, marginTop: 6, boxShadow: `0 0 0 1px ${p.border}` }} />
      ) : null}
      {kind === "video" && message.video ? (
        <div style={{ marginTop: 6 }}><ChatVideo message={message} timeMs={model.timeMs} arrivalMs={view.arrivalMs} width={260} radius={8} /></div>
      ) : null}
      {kind === "attachment" ? (message.attachments ?? []).map((file, index) => {
        const extension = (file.name.split(".").pop() ?? "file").toUpperCase().slice(0, 4);
        return (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, border: `1px solid ${p.border}`, borderRadius: 10, padding: "10px 12px", background: p.file }}>
            <FileTile extension={extension} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: p.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
              <div style={{ fontSize: 13, color: p.secondary, marginTop: 2 }}>{[extension, file.size].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
        );
      }) : null}
      {kind === "audio" && message.audio ? <Clip view={view} p={p} /> : null}
    </>
  );
}

function Quote({ view, model, p }: { view: ChatMessageView; model: ChatModel; p: Palette }) {
  const reply = view.message.replyTo!;
  const name = reply.direction === "outgoing" ? model.me.name : reply.sender ?? model.contact.name;
  return (
    <div style={{ borderLeft: `4px solid ${p.rule}`, borderRadius: 2, padding: "1px 0 1px 12px", margin: "2px 0 6px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: p.text }}>{name}</div>
      <div style={{ fontSize: 14.5, lineHeight: "20px", color: p.secondary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{reply.text}</div>
    </div>
  );
}

function Unfurl({ link, p }: { link: NonNullable<ChatMessageView["message"]["link"]>; p: Palette }) {
  const host = hostOf(link);
  return (
    <div style={{ display: "flex", marginTop: 6 }}>
      <span style={{ width: 4, borderRadius: 2, background: p.rule, flexShrink: 0 }} />
      <div style={{ paddingLeft: 12, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: p.text }}>{host}</div>
        {link.title ? <div style={{ fontSize: 15.5, lineHeight: "21px", fontWeight: 700, color: p.link, marginTop: 3, letterSpacing: -0.15 }}>{link.title}</div> : null}
        {link.image ? <img src={link.image} alt="" draggable={false} style={{ display: "block", width: "100%", maxWidth: 296, aspectRatio: "2", objectFit: "cover", borderRadius: 8, marginTop: 8, boxShadow: `0 0 0 1px ${p.border}` }} /> : null}
      </div>
    </div>
  );
}

function Clip({ view, p }: { view: ChatMessageView; p: Palette }) {
  const bars = waveformBars(view.message, 36);
  const progress = view.audioProgress ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, border: `1px solid ${p.border}`, borderRadius: 12, padding: "10px 12px", width: 270, boxSizing: "border-box" }}>
      <span style={{ width: 34, height: 34, borderRadius: 17, background: p.text, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden><path d="M2 1.5v13c0 .7.8 1.1 1.4.7l10-6.5c.5-.4.5-1.1 0-1.4l-10-6.5C2.8.4 2 .8 2 1.5z" fill={p.bg} /></svg>
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, height: 24 }}>
        {bars.map((bar, index) => <span key={index} style={{ width: 2.4, height: Math.max(3, bar * 22), borderRadius: 1.2, background: index / bars.length < progress ? p.link : p.faint, opacity: index / bars.length < progress ? 1 : 0.6 }} />)}
      </div>
      <span style={{ fontSize: 13, color: p.secondary, fontVariantNumeric: "tabular-nums" }}>{durationLabel(view.message.audio!.duration)}</span>
    </div>
  );
}

function Chips({ view, p }: { view: ChatMessageView; p: Palette }) {
  if (view.reactions.length === 0) return null;
  const groups = new Map<string, { emoji: string; count: number; mine: boolean; enter: number; id: string }>();
  for (const reaction of view.reactions) {
    const existing = groups.get(reaction.emoji);
    if (existing) {
      existing.count += 1;
      existing.mine ||= reaction.byMe;
      existing.enter = Math.min(existing.enter, reaction.enter);
    } else {
      groups.set(reaction.emoji, { emoji: reaction.emoji, count: 1, mine: reaction.byMe, enter: reaction.enter, id: reaction.id });
    }
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {[...groups.values()].map((chip) => (
        <span key={chip.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 9px 0 8px", borderRadius: 13, background: chip.mine ? p.chipMine : p.chip, boxShadow: chip.mine ? `inset 0 0 0 1.2px ${p.chipMineBorder}` : undefined, transform: `scale(${chip.enter >= 1 ? 1 : popScale(chip.enter)})`, opacity: Math.min(1, chip.enter * 3) }}>
          <span style={{ fontSize: 15, lineHeight: "18px" }}>{chip.emoji}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: chip.mine ? p.chipMineText : p.secondary }}>{chip.count}</span>
        </span>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 26, borderRadius: 13, background: p.chip }}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path d="M15.3 8.4a6.6 6.6 0 1 1-5.7-5.9M5.9 10.6c.7.9 1.7 1.5 3 1.5s2.3-.6 3-1.5M6.5 7v.4M11.3 7v.4M13.6 1.4v4.4M11.4 3.6h4.4" fill="none" stroke={p.secondary} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}

function TypingLine({ model, p }: { model: ChatModel; p: Palette }) {
  return (
    <div style={{ height: 22, padding: "0 16px", display: "flex", alignItems: "center", fontSize: 12.5, color: p.secondary, flexShrink: 0, opacity: model.typing.visible ? model.typing.enter : 0, letterSpacing: -0.05 }}>
      {model.typing.visible ? <span><span style={{ fontWeight: 700 }}>{model.typing.who.name}</span> is typing…</span> : null}
    </div>
  );
}

function Composer({ model, p }: { model: ChatModel; p: Palette }) {
  const text = model.draft.text;
  const typing = text.length > 0;
  const placeholder = `Message ${model.group ? `#${model.groupName ?? model.contact.name}` : model.contact.name}`;
  return (
    <div data-slot="chat-composer" style={{ position: "relative", flexShrink: 0, background: p.bg, boxShadow: `0 -1px 0 ${p.border}`, padding: `10px 16px ${HOME_AREA_HEIGHT}px`, zIndex: 20 }}>
      <div style={{ fontSize: 16, lineHeight: "22px", minHeight: 22, letterSpacing: -0.2, padding: "2px 0 8px" }}>
        {typing ? (
          <>
            <span style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", color: p.text }}>{text}</span>
            <Caret visible={model.draft.caret} color={p.caret} height={22} />
          </>
        ) : <span style={{ color: p.faint }}>{placeholder}</span>}
      </div>
      <div style={{ height: 38, display: "flex", alignItems: "center", gap: 18 }}>
        <span style={{ width: 30, height: 30, borderRadius: 15, background: p.plusBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1.5v11M1.5 7h11" stroke={p.glyph} strokeWidth="1.8" strokeLinecap="round" /></svg>
        </span>
        <span style={{ fontSize: 17, fontWeight: 600, color: p.glyph, letterSpacing: -0.3 }}>Aa</span>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><circle cx="11" cy="11" r="8.6" fill="none" stroke={p.glyph} strokeWidth="1.6" /><path d="M7.4 12.8c.8 1.1 2 1.8 3.6 1.8s2.8-.7 3.6-1.8M8.2 8.6v.6M13.8 8.6v.6" fill="none" stroke={p.glyph} strokeWidth="1.6" strokeLinecap="round" /></svg>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><circle cx="11" cy="11" r="3.6" fill="none" stroke={p.glyph} strokeWidth="1.6" /><path d="M14.6 11v1.3a2.4 2.4 0 0 0 4.8 0V11a8.4 8.4 0 1 0-3.3 6.7" fill="none" stroke={p.glyph} strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span style={{ flex: 1 }} />
        {typing ? null : (
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><rect x="7.5" y="2.5" width="7" height="12" rx="3.5" fill="none" stroke={p.glyph} strokeWidth="1.6" /><path d="M4.5 10.5a6.5 6.5 0 0 0 13 0M11 17v3" fill="none" stroke={p.glyph} strokeWidth="1.6" strokeLinecap="round" /></svg>
        )}
        <span style={{ width: 34, height: 30, borderRadius: 7, background: typing ? p.send : "transparent", display: "flex", alignItems: "center", justifyContent: "center", marginRight: -4 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path d="M2.4 2.6l13.2 6c.4.2.4.7 0 .9l-13.2 6c-.4.2-.9-.2-.7-.6L3.9 9 1.7 3.2c-.2-.4.3-.8.7-.6zM3.9 9h5.6" fill="none" stroke={typing ? "#FFFFFF" : p.faint} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
