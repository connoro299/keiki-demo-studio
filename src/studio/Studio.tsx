import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DemoChannel } from "@/contracts";
import type { OutreachDraft, SiteProfile } from "@/outreach/types";
import { CHANNEL_LABELS, CHANNEL_ORDER, parseSites, readStore, streamMake, writeStore } from "./client";
import { Phone } from "./Phone";
import { sampleItem } from "./sample";
import { encodeShare, shareUrl } from "./share";
import "./studio.css";

export type StudioStatus = "queued" | "reading" | "writing" | "email" | "ready" | "failed";

export type StudioItem = {
  id: string;
  url: string;
  status: StudioStatus;
  error?: string;
  createdAt: string;
  profile?: SiteProfile;
  channel?: DemoChannel;
  flow?: Record<string, unknown>;
  story?: string;
  stories: string[];
  draft?: OutreachDraft;
  sample?: boolean;
};

type Notice = { kind: "missing_key" | "access"; message: string } | null;

const ITEMS_KEY = "keiki-studio-items";
const CODE_KEY = "keiki-studio-code";
const NAME_KEY = "keiki-studio-sender";
const CONCURRENCY = 2;

const STEPS: Array<{ key: StudioStatus; label: string }> = [
  { key: "reading", label: "Reading site" },
  { key: "writing", label: "Writing conversation" },
  { key: "email", label: "Drafting email" },
  { key: "ready", label: "Ready" },
];

function hostOf(url: string): string {
  try {
    return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function newId(url: string): string {
  return `${hostOf(url)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function Studio() {
  const [items, setItems] = useState<StudioItem[]>(() => readStore<StudioItem[]>(ITEMS_KEY, []).map(item => (item.status === "ready" || item.status === "failed" ? item : { ...item, status: "failed", error: "Interrupted. Try again." })));
  const [selectedId, setSelectedId] = useState<string | null>(() => items[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [code, setCode] = useState<string>(() => readStore<string>(CODE_KEY, ""));
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => { document.title = "Demo Studio · Keiki"; }, []);
  useEffect(() => writeStore(ITEMS_KEY, items.filter(item => !item.sample).slice(0, 60)), [items]);

  const patch = useCallback((id: string, update: Partial<StudioItem> | ((item: StudioItem) => Partial<StudioItem>)) => {
    setItems(current => current.map(item => (item.id === id ? { ...item, ...(typeof update === "function" ? update(item) : update) } : item)));
  }, []);

  const make = useCallback(async (id: string, extra: { channel?: DemoChannel; reuseProfile?: boolean } = {}) => {
    const item = itemsRef.current.find(entry => entry.id === id);
    if (!item) return;
    const previousStories = item.story ? [...item.stories, item.story] : item.stories;
    patch(id, { status: extra.reuseProfile ? "writing" : "reading", error: undefined, ...(extra.reuseProfile ? {} : { flow: undefined, draft: undefined }) });
    await streamMake(
      { url: item.url, channel: extra.channel, ...(extra.reuseProfile && item.profile ? { profile: item.profile, previousStories } : {}) },
      readStore<string>(CODE_KEY, "") || null,
      event => {
        switch (event.type) {
          case "step": patch(id, { status: event.step === "read" ? "reading" : event.step === "write" ? "writing" : "email" }); break;
          case "profile": patch(id, { profile: event.profile }); break;
          case "demo": patch(id, { flow: event.flow, channel: event.channel, story: event.story, stories: previousStories }); break;
          case "email": patch(id, { draft: event.draft }); break;
          case "done": patch(id, { status: "ready" }); break;
          case "error":
            if (event.code === "missing_key" || event.code === "access") setNotice({ kind: event.code, message: event.message });
            patch(id, { status: "failed", error: event.message });
            break;
        }
      },
    );
    patch(id, current => (current.status === "ready" || current.status === "failed" ? {} : { status: "failed", error: "The connection closed early. Try again." }));
  }, [patch]);

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && queue.current.length > 0) {
      const id = queue.current.shift()!;
      active.current += 1;
      void make(id).finally(() => {
        active.current -= 1;
        pump();
      });
    }
  }, [make]);

  const submit = () => {
    const sites = parseSites(input);
    if (sites.length === 0) return;
    const created = sites.map<StudioItem>(url => ({ id: newId(url), url, status: "queued", createdAt: new Date().toISOString(), stories: [] }));
    setItems(current => [...created, ...current]);
    itemsRef.current = [...created, ...itemsRef.current];
    setSelectedId(created[0].id);
    setInput("");
    setNotice(null);
    queue.current.push(...created.map(item => item.id));
    pump();
  };

  const showSample = () => {
    const sample = sampleItem();
    setItems(current => [sample, ...current.filter(item => item.id !== sample.id)]);
    setSelectedId(sample.id);
    setNotice(null);
  };

  const remove = (id: string) => {
    setItems(current => current.filter(item => item.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const selected = items.find(item => item.id === selectedId) ?? null;
  const siteCount = parseSites(input).length;

  return (
    <div className="st">
      <header className="st-top">
        <a className="st-brand" href="/" onClick={event => { event.preventDefault(); setSelectedId(null); }}>
          <span className="st-mark" aria-hidden="true" />
          Demo Studio
        </a>
        <a className="st-top-link" href="https://onkeiki.com" target="_blank" rel="noreferrer">Keiki</a>
      </header>

      <main className="st-main">
        <section className={selected ? "st-compose st-compose-compact" : "st-compose"}>
          {!selected && (
            <>
              <h1 className="st-title">Show any business its own agent.</h1>
              <p className="st-sub">Paste a website. We read it, write a conversation between a customer and that business's agent, play it on a phone, and draft the email to send it.</p>
            </>
          )}
          <form className="st-input" onSubmit={event => { event.preventDefault(); submit(); }}>
            <textarea
              value={input}
              rows={1}
              placeholder="sproutdental.com"
              aria-label="Website"
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
            />
            <button type="submit" className="st-btn st-btn-primary" disabled={siteCount === 0}>
              {siteCount > 1 ? `Make ${siteCount} demos` : "Make demo"}
            </button>
          </form>
          {!selected && (
            <p className="st-hint">
              Paste several sites, one per line, to make a batch. Or <button type="button" className="st-link" onClick={showSample}>see an example</button>.
            </p>
          )}
          {notice && <NoticeBar notice={notice} code={code} setCode={setCode} onSample={showSample} onRetry={() => { setNotice(null); if (selected) void make(selected.id); }} />}
        </section>

        {selected && <Workspace key={selected.id} item={selected} patch={patch} make={make} />}

        {items.length > 0 && (
          <section className="st-recent">
            <div className="st-recent-head">
              <h2>{selected ? "All demos" : "Your demos"}</h2>
              <span>{items.filter(item => item.status === "ready").length} ready · saved in this browser</span>
            </div>
            <div className="st-grid">
              {items.map(item => (
                <button key={item.id} type="button" className={item.id === selectedId ? "st-card st-card-on" : "st-card"} onClick={() => setSelectedId(item.id)}>
                  <span className={`st-card-thumb st-thumb-${item.channel ?? "none"}`}>
                    <span className="st-card-initial">{(item.profile?.name ?? hostOf(item.url)).slice(0, 1).toUpperCase()}</span>
                  </span>
                  <span className="st-card-name">{item.profile?.name ?? hostOf(item.url)}</span>
                  <span className={`st-card-status st-status-${item.status}`}>{statusLabel(item)}</span>
                  <span className="st-card-x" role="button" aria-label={`Remove ${hostOf(item.url)}`} onClick={event => { event.stopPropagation(); remove(item.id); }}>×</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function statusLabel(item: StudioItem): string {
  switch (item.status) {
    case "queued": return "Waiting";
    case "reading": return "Reading site…";
    case "writing": return "Writing…";
    case "email": return "Drafting email…";
    case "ready": return item.channel ? CHANNEL_LABELS[item.channel] : "Ready";
    case "failed": return "Didn't work";
  }
}

function NoticeBar({ notice, code, setCode, onSample, onRetry }: { notice: NonNullable<Notice>; code: string; setCode: (value: string) => void; onSample: () => void; onRetry: () => void }) {
  if (notice.kind === "access") {
    return (
      <form className="st-notice" onSubmit={event => { event.preventDefault(); writeStore(CODE_KEY, code); onRetry(); }}>
        <span>This studio needs an access code.</span>
        <input value={code} onChange={event => setCode(event.target.value)} placeholder="Access code" aria-label="Access code" />
        <button type="submit" className="st-btn">Continue</button>
      </form>
    );
  }
  return (
    <div className="st-notice">
      <span>Demo generation isn't switched on for this deployment yet. {notice.message}</span>
      <button type="button" className="st-btn" onClick={onSample}>See an example</button>
    </div>
  );
}

function Workspace({ item, patch, make }: { item: StudioItem; patch: (id: string, update: Partial<StudioItem>) => void; make: (id: string, extra?: { channel?: DemoChannel; reuseProfile?: boolean }) => Promise<void> }) {
  const [channel, setChannel] = useState<DemoChannel>(item.channel ?? "imessage");
  const [playKey, setPlayKey] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const [sender, setSender] = useState<string>(() => readStore<string>(NAME_KEY, ""));
  const [copied, setCopied] = useState<string | null>(null);
  const working = item.status !== "ready" && item.status !== "failed";

  useEffect(() => { if (item.channel) setChannel(item.channel); }, [item.channel, item.flow]);
  useEffect(() => {
    setLink(null);
    if (!item.flow || item.status !== "ready") return;
    let cancelled = false;
    void encodeShare(item.flow as never, channel)
      .then(token => shareUrl(token))
      .then(url => { if (!cancelled) setLink(url); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [item.flow, item.status, channel]);

  const draft = item.draft;
  const contacts = useMemo(() => (item.profile?.contacts ?? []).filter(contact => contact.kind === "email" || contact.kind === "form"), [item.profile]);
  const to = draft?.to;
  const finalBody = useMemo(() => {
    if (!draft) return "";
    let body = draft.body.replace(/\{\{sender_name\}\}/g, sender.trim() || "{{sender_name}}");
    if (link && !body.includes(link)) {
      const signOff = body.search(/\n[^\n]*, Keiki\b/);
      const line = `Here's the 20-second demo: ${link}\n`;
      body = signOff >= 0 ? `${body.slice(0, signOff)}\n${line}${body.slice(signOff)}` : `${body}\n\n${line}`;
    }
    return body;
  }, [draft, sender, link]);

  const flash = (label: string) => { setCopied(label); window.setTimeout(() => setCopied(null), 1600); };
  const copy = async (text: string, label: string) => { try { await navigator.clipboard.writeText(text); flash(label); } catch { /* clipboard blocked */ } };
  const updateDraft = (next: Partial<OutreachDraft>) => { if (draft) patch(item.id, { draft: { ...draft, ...next } }); };
  const mailto = draft && to?.kind === "email" ? `mailto:${to.value}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(finalBody)}` : null;
  const stepIndex = STEPS.findIndex(step => step.key === item.status);

  return (
    <section className="st-work">
      <div className="st-steps" aria-live="polite">
        {item.status === "failed" ? (
          <span className="st-step st-step-fail">{item.error ?? "Something went wrong."} <button type="button" className="st-link" onClick={() => void make(item.id)}>Try again</button></span>
        ) : item.status === "queued" ? (
          <span className="st-step">Waiting for the batch…</span>
        ) : (
          STEPS.map((step, index) => (
            <span key={step.key} className={index < stepIndex || item.status === "ready" ? "st-step st-step-done" : index === stepIndex ? "st-step st-step-now" : "st-step"}>
              <span className="st-dot" aria-hidden="true" />
              {step.label}
            </span>
          ))
        )}
      </div>

      <div className="st-split">
        <div className="st-stage">
          <div className="st-seg" role="tablist" aria-label="Channel">
            {CHANNEL_ORDER.map(option => (
              <button key={option} type="button" role="tab" aria-selected={channel === option} className={channel === option ? "st-seg-on" : ""} onClick={() => { setChannel(option); setPlayKey(key => key + 1); }} disabled={!item.flow}>
                {CHANNEL_LABELS[option]}
              </button>
            ))}
          </div>
          {item.flow ? (
            <Phone flow={item.flow} channel={channel} width={300} playKey={playKey} />
          ) : (
            <div className="st-phone st-phone-wait" style={{ width: 300, height: 300 * 874 / 402 + 6 }}>
              <div className="st-phone-glass st-skeleton">
                {item.status === "failed" ? <span>No demo yet</span> : <span className="st-pulse">{item.status === "reading" ? "Reading the site" : "Writing the conversation"}</span>}
              </div>
            </div>
          )}
          <div className="st-stage-actions">
            <button type="button" className="st-btn" disabled={!item.flow} onClick={() => setPlayKey(key => key + 1)}>Replay</button>
            <button type="button" className="st-btn" disabled={!link} onClick={() => link && void copy(link, "link")}>{copied === "link" ? "Link copied" : "Copy demo link"}</button>
            {link && <a className="st-btn st-btn-ghost" href={link} target="_blank" rel="noreferrer">Open</a>}
          </div>
        </div>

        <div className="st-panel">
          <div className="st-block">
            <h2 className="st-biz">{item.profile?.name ?? hostOf(item.url)}</h2>
            <a className="st-domain" href={item.url} target="_blank" rel="noreferrer">{hostOf(item.url)}</a>
            {item.profile ? <p className="st-summary">{item.profile.summary}</p> : <p className="st-summary st-muted">{working ? "Reading their site…" : ""}</p>}
          </div>

          <div className="st-block">
            <div className="st-label">What their agent does</div>
            {item.story ? <p className="st-story">{item.story}</p> : <p className="st-story st-muted">{working ? "Writing…" : "—"}</p>}
            {item.profile && !item.sample && (
              <button type="button" className="st-link" disabled={working} onClick={() => void make(item.id, { reuseProfile: true, channel })}>
                {working ? "Working…" : "Try another story"}
              </button>
            )}
          </div>

          <div className="st-block">
            <div className="st-label">Send to</div>
            {contacts.length > 0 && draft ? (
              <select
                className="st-select"
                value={to?.value ?? ""}
                onChange={event => updateDraft({ to: contacts.find(contact => contact.value === event.target.value), channel: contacts.find(contact => contact.value === event.target.value)?.kind === "form" ? "form" : "email" })}
              >
                {contacts.map(contact => (
                  <option key={contact.value} value={contact.value}>{contact.kind === "form" ? "Contact form" : contact.value}{contact.label ? ` · ${contact.label}` : ""}</option>
                ))}
              </select>
            ) : (
              <p className="st-muted st-small">{working ? "Looking for a contact…" : item.profile ? "No public email found. Use their contact form or DM them." : "—"}</p>
            )}
          </div>

          {draft ? (
            <div className="st-mail">
              <input className="st-mail-subject" value={draft.subject} onChange={event => updateDraft({ subject: event.target.value })} aria-label="Subject" />
              <textarea className="st-mail-body" value={finalBody} onChange={event => updateDraft({ body: event.target.value })} aria-label="Email" rows={11} />
              <div className="st-mail-foot">
                <input className="st-sender" value={sender} placeholder="Your name" aria-label="Your name" onChange={event => { setSender(event.target.value); writeStore(NAME_KEY, event.target.value); }} />
                <div className="st-mail-actions">
                  <button type="button" className="st-btn" onClick={() => void copy(`Subject: ${draft.subject}\n\n${finalBody}`, "email")}>{copied === "email" ? "Copied" : "Copy"}</button>
                  {mailto ? (
                    <a className="st-btn st-btn-primary" href={mailto}>Open in Mail</a>
                  ) : to?.kind === "form" ? (
                    <a className="st-btn st-btn-primary" href={to.value} target="_blank" rel="noreferrer">Open contact form</a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="st-mail st-skeleton st-mail-wait">{working ? <span className="st-pulse">The email is drafted after the demo</span> : <span>No email yet</span>}</div>
          )}
        </div>
      </div>
    </section>
  );
}
