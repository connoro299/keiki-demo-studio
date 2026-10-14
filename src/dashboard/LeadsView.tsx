import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { ContactPoint, Lead, LeadStatus } from "@/outreach/types";
import { api, mediaUrl, type LeadsResponse } from "./client";
import {
  CHANNEL_LABEL,
  CONTACT_LABEL,
  LEAD_FILTERS,
  LEAD_STATUS_LABEL,
  bestContact,
  domainOf,
  isWorking,
  leadChannels,
  mailtoUrl,
  matchesFilter,
  parseSiteList,
  rankedContacts,
  relativeTime,
  type LeadFilter,
} from "./format";
import { CommandBlock, DemoVideo, EmptyState, StatusPill, useFlash } from "./ui";

type Props = { data: LeadsResponse | null; onRefresh: () => Promise<void>; onLead: (lead: Lead) => void };

const wide = () => window.matchMedia("(min-width: 861px)").matches;

export function LeadsView({ data, onRefresh, onLead }: Props) {
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const leads = data?.leads ?? [];
  const visible = useMemo(() => sortLeads(leads.filter((lead) => matchesFilter(lead, filter))), [leads, filter]);
  const selected = leads.find((lead) => lead.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && visible.length && wide()) setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  const counts = useMemo(() => Object.fromEntries(LEAD_FILTERS.map((f) => [f.id, leads.filter((lead) => matchesFilter(lead, f.id)).length])), [leads]);

  return (
    <div className="ox-leads" data-has-selection={selected ? "true" : "false"}>
      <aside className="ox-sidebar">
        <AddSites pipeline={data?.pipeline} onAdded={onRefresh} />
        <div className="ox-filters" role="tablist" aria-label="Filter leads">
          {LEAD_FILTERS.filter((f) => f.id === "all" || counts[f.id]).map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="ox-chip" onClick={() => setFilter(f.id)}>
              {f.label} <span className="ox-chip-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        {data === null ? (
          <div className="ox-loading">Loading…</div>
        ) : leads.length === 0 ? (
          <EmptyState
            title="No leads yet"
            commands={["npm run outreach -- add https://example.com", "npm run outreach -- import leads.csv", "npm run outreach -- run"]}
          >
            Paste sites above, or add them from a terminal. Each site gets analyzed, a demo per channel, and a drafted email for you to review here.
          </EmptyState>
        ) : visible.length === 0 ? (
          <p className="ox-muted ox-pad">Nothing here.</p>
        ) : (
          <ul className="ox-list" aria-label="Leads">
            {visible.map((lead) => (
              <LeadRow key={lead.id} lead={lead} selected={lead.id === selected?.id} onSelect={() => setSelectedId(lead.id)} />
            ))}
          </ul>
        )}
      </aside>
      <section className="ox-detail" aria-label="Lead detail">
        {selected ? (
          <LeadDetail key={selected.id} lead={selected} onLead={onLead} onBack={() => setSelectedId(null)} />
        ) : leads.length ? (
          <div className="ox-detail-empty">Select a lead to review its demos and draft.</div>
        ) : null}
      </section>
    </div>
  );
}

/** Review order: ready drafts first, then work in flight, then everything already handled. */
const STATUS_ORDER: LeadStatus[] = ["drafted", "approved", "rendering", "generating", "analyzing", "queued", "failed", "sent", "skipped"];

function sortLeads(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt));
}

function LeadRow({ lead, selected, onSelect }: { lead: Lead; selected: boolean; onSelect: () => void }) {
  const contact = bestContact(lead);
  const channels = leadChannels(lead);
  return (
    <li>
      <button type="button" className="ox-row" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <div className="ox-row-top">
          <span className="ox-row-title">{lead.profile?.name ?? domainOf(lead.url)}</span>
          <StatusPill status={lead.status} label={LEAD_STATUS_LABEL[lead.status]} />
        </div>
        {lead.profile ? (
          <div className="ox-row-sub">
            {domainOf(lead.url)}
            {lead.profile.vertical ? <> · {lead.profile.vertical}</> : null}
          </div>
        ) : null}
        {lead.status === "failed" && lead.error ? (
          <div className="ox-row-meta ox-row-error">{lead.error}</div>
        ) : contact || channels.length ? (
          <div className="ox-row-meta">
            {contact ? <span className="ox-ellipsis">{contact.value}</span> : null}
            {channels.length ? <span className="ox-row-channels">{channels.map((c) => CHANNEL_LABEL[c]).join(" · ")}</span> : null}
          </div>
        ) : (
          <div className="ox-row-meta">Added {relativeTime(lead.createdAt)} ago</div>
        )}
      </button>
    </li>
  );
}

function AddSites({ pipeline, onAdded }: { pipeline?: LeadsResponse["pipeline"]; onAdded: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"add" | "run" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const urls = parseSiteList(text);

  const add = async () => {
    if (!urls.length) return;
    setBusy("add");
    try {
      const result = await api.addLeads(urls);
      setText("");
      setMessage({ tone: "ok", text: `Added ${result.leads.length} site${result.leads.length === 1 ? "" : "s"}${result.invalid.length ? `, skipped ${result.invalid.length} invalid` : ""}.` });
      await onAdded();
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("run");
    try {
      const result = await api.run();
      setMessage({ tone: "ok", text: `Pipeline started (${result.command}). This list refreshes as leads move.` });
      window.setTimeout(() => void onAdded(), 1500);
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    const dropped = file ? (await file.text()).trim() : event.dataTransfer.getData("text").trim();
    setText((current) => [current.trim(), dropped].filter(Boolean).join("\n"));
  };

  return (
    <div
      className="ox-add"
      data-dragging={dragging ? "true" : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <label className="ox-label" htmlFor="ox-add-sites">Add sites</label>
      <textarea
        id="ox-add-sites"
        className="ox-input ox-add-input"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={"harborbarbers.co\nhttps://sproutdental.com\nor drop a CSV"}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void add();
        }}
      />
      <div className="ox-add-actions">
        <button type="button" className="ox-btn ox-btn-primary" disabled={!urls.length || busy !== null} onClick={add}>
          {busy === "add" ? "Adding…" : urls.length > 1 ? `Add ${urls.length} sites` : "Add"}
        </button>
        <button
          type="button"
          className="ox-btn"
          disabled={busy !== null || pipeline?.cli === false}
          onClick={run}
          title={pipeline?.cli === false ? "The outreach pipeline is not installed on this branch" : "Runs npm run outreach -- run"}
        >
          {busy === "run" ? "Starting…" : "Run pipeline"}
        </button>
      </div>
      {message ? <p className={`ox-note ${message.tone === "error" ? "ox-note-error" : ""}`}>{message.text}</p> : null}
      {pipeline && !pipeline.cli && !message ? <p className="ox-note">Pipeline not installed here; sites are queued until it is.</p> : null}
    </div>
  );
}

function LeadDetail({ lead, onLead, onBack }: { lead: Lead; onLead: (lead: Lead) => void; onBack: () => void }) {
  const contacts = rankedContacts(lead);
  const [to, setTo] = useState<ContactPoint | undefined>(lead.draft?.to ?? contacts.find((c) => c.kind === "email") ?? contacts[0]);
  const [toText, setToText] = useState(to?.value ?? "");
  const [subject, setSubject] = useState(lead.draft?.subject ?? "");
  const [body, setBody] = useState(lead.draft?.body ?? "");
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [flash, setFlash] = useFlash();
  const [saving, setSaving] = useState(false);
  const pending = useRef<number | undefined>(undefined);

  const save = (patch: Parameters<typeof api.patchLead>[1], quiet = false) => {
    setSaving(true);
    return api
      .patchLead(lead.id, patch)
      .then((next) => {
        onLead(next);
        if (!quiet) setFlash("Saved");
        return next;
      })
      .catch((err: Error) => setFlash(err.message))
      .finally(() => setSaving(false));
  };

  const scheduleSave = (patch: Parameters<typeof api.patchLead>[1]) => {
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => void save(patch), 700);
  };
  useEffect(() => () => window.clearTimeout(pending.current), []);

  const pickContact = (contact: ContactPoint) => {
    setTo(contact);
    setToText(contact.value);
    void save({ draft: { to: contact } });
  };

  const setStatus = async (status: LeadStatus) => {
    window.clearTimeout(pending.current);
    await save({ status, draft: { subject, body, to: to && to.value === toText ? to : toText || null }, notes }, true);
    setFlash(status === "sent" ? "Marked sent" : status === "skipped" ? "Skipped" : "Updated");
  };

  const emailTo = to?.kind === "email" && to.value === toText ? to.value : /@/.test(toText) ? toText : "";
  const copyEmail = async () => {
    const text = `${emailTo ? `To: ${emailTo}\n` : ""}Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setFlash("Copied");
    } catch {
      setFlash("Copy failed");
    }
  };

  const profile = lead.profile;
  const firstVideo = lead.demos.find((demo) => demo.mp4);
  const firstGif = lead.demos.find((demo) => demo.gif);
  const done = lead.status === "sent" || lead.status === "skipped";

  return (
    <article className="ox-article">
      <button type="button" className="ox-back" onClick={onBack}>‹ Leads</button>
      <header className="ox-article-head">
        <div className="ox-article-title">
          <h2>{profile?.name ?? domainOf(lead.url)}</h2>
          <div className="ox-article-sub">
            <a href={lead.url} target="_blank" rel="noreferrer">{domainOf(lead.url)}</a>
            {profile?.vertical ? <span> · {profile.vertical}</span> : null}
            <span> · updated {relativeTime(lead.updatedAt)} ago</span>
          </div>
        </div>
        <StatusPill status={lead.status} label={LEAD_STATUS_LABEL[lead.status]} />
      </header>

      {lead.status === "failed" ? (
        <div className="ox-callout ox-callout-error">
          {lead.failedStep ? <strong>Failed at {lead.failedStep}. </strong> : null}
          {lead.error ?? "The pipeline failed on this site."}
          <div className="ox-callout-cmd">Retry: <code>npm run outreach -- redo {lead.id}{lead.failedStep ? ` --from ${lead.failedStep}` : ""}</code></div>
        </div>
      ) : null}
      {isWorking(lead.status) ? (
        <div className="ox-callout">
          {LEAD_STATUS_LABEL[lead.status]}… The demos and draft appear here when the pipeline finishes.
        </div>
      ) : null}

      <div className="ox-article-body" data-demos={lead.demos.length ? "true" : undefined}>
      {profile ? (
        <section className="ox-section ox-area-summary">
          {profile.tagline ? <p className="ox-tagline">{profile.tagline}</p> : null}
          <p className="ox-summary">{profile.summary}</p>
          {profile.offerings.length ? (
            <div className="ox-tags">
              {profile.offerings.map((offering) => <span key={offering} className="ox-tag">{offering}</span>)}
            </div>
          ) : null}
        </section>
      ) : null}

      {lead.demos.length ? (
        <section className="ox-section ox-area-demos">
          <h3 className="ox-section-title">Demos</h3>
          <div className="ox-demos">
            {lead.demos.map((demo) => (
              <figure key={demo.flowId} className="ox-demo">
                <DemoVideo src={demo.mp4} poster={demo.poster} label={`${CHANNEL_LABEL[demo.channel]} demo`} />
                <figcaption>
                  <span className="ox-demo-channel">{CHANNEL_LABEL[demo.channel]}</span>
                  <span className="ox-demo-story">{demo.story}</span>
                  {demo.renderError ? <span className="ox-demo-error">Render failed: {demo.renderError}</span> : null}
                  <span className="ox-demo-links">
                    {demo.mp4 ? <a href={mediaUrl(demo.mp4, true)} download>MP4</a> : null}
                    {demo.gif ? <a href={mediaUrl(demo.gif, true)} download>GIF</a> : null}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {lead.draft || contacts.length ? (
        <section className="ox-section ox-area-email">
          <h3 className="ox-section-title">Email</h3>
          {contacts.length ? (
            <div className="ox-contacts" role="radiogroup" aria-label="Contacts">
              {contacts.map((contact) => {
                const active = to?.value === contact.value && toText === contact.value;
                return (
                  <button
                    key={`${contact.kind}:${contact.value}`}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className="ox-contact"
                    onClick={() => pickContact(contact)}
                  >
                    <span className="ox-contact-kind">{CONTACT_LABEL[contact.kind]}</span>
                    <span className="ox-contact-main">
                      <span className="ox-ellipsis ox-contact-value">{contact.value}</span>
                      {contact.label ? <span className="ox-contact-label">{contact.label}</span> : null}
                    </span>
                    <span className="ox-meter" title={`confidence ${Math.round(contact.confidence * 100)}%`}>
                      <span style={{ width: `${Math.round(contact.confidence * 100)}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="ox-form">
            <label className="ox-field">
              <span className="ox-field-label">To</span>
              <input
                className="ox-input"
                value={toText}
                onChange={(event) => {
                  setToText(event.target.value);
                  scheduleSave({ draft: { to: event.target.value || null } });
                }}
                placeholder="name@business.com"
              />
            </label>
            <label className="ox-field">
              <span className="ox-field-label">Subject</span>
              <input
                className="ox-input"
                value={subject}
                onChange={(event) => {
                  setSubject(event.target.value);
                  scheduleSave({ draft: { subject: event.target.value } });
                }}
              />
            </label>
            <label className="ox-field ox-field-block">
              <span className="ox-field-label">Body</span>
              <textarea
                className="ox-input ox-body"
                rows={11}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  scheduleSave({ draft: { body: event.target.value } });
                }}
              />
            </label>
          </div>
          {lead.draft?.variants?.form || lead.draft?.variants?.xDm ? (
            <div className="ox-variants">
              {lead.draft.variants.form ? <Variant label="Contact form" text={lead.draft.variants.form} /> : null}
              {lead.draft.variants.xDm ? <Variant label="X DM / LinkedIn" text={lead.draft.variants.xDm} /> : null}
            </div>
          ) : null}
          {to && to.kind === "form" && to.value === toText ? (
            <p className="ox-note">This contact is a form. Copy the email, then <a href={to.value} target="_blank" rel="noreferrer">open the form</a>.</p>
          ) : null}
        </section>
      ) : null}

      <section className="ox-section ox-area-notes">
        <label className="ox-field ox-field-block">
          <span className="ox-field-label">Notes</span>
          <textarea
            className="ox-input"
            rows={2}
            value={notes}
            placeholder="Private notes"
            onChange={(event) => {
              setNotes(event.target.value);
              scheduleSave({ notes: event.target.value });
            }}
          />
        </label>
      </section>
      </div>

      {lead.draft || lead.demos.length || !isWorking(lead.status) ? (
      <footer className="ox-actionbar">
        <div className="ox-actionbar-left">
          <button type="button" className="ox-btn" onClick={copyEmail} disabled={!body}>Copy email</button>
          <a
            className="ox-btn"
            aria-disabled={!emailTo}
            href={emailTo ? mailtoUrl(emailTo, subject, body) : undefined}
            onClick={(event) => {
              if (!emailTo) event.preventDefault();
            }}
          >
            Open in Mail
          </a>
          {firstVideo?.mp4 ? <a className="ox-btn" href={mediaUrl(firstVideo.mp4, true)} download>Download MP4</a> : null}
          {firstGif?.gif ? <a className="ox-btn" href={mediaUrl(firstGif.gif, true)} download>Download GIF</a> : null}
        </div>
        <div className="ox-actionbar-right">
          <span className="ox-flash" aria-live="polite">{flash ?? (saving ? "Saving…" : "")}</span>
          {done ? (
            <button type="button" className="ox-btn" onClick={() => setStatus("drafted")}>Move back to ready</button>
          ) : (
            <>
              <button type="button" className="ox-btn ox-btn-quiet" onClick={() => setStatus("skipped")}>Skip</button>
              <button type="button" className="ox-btn ox-btn-primary" onClick={() => setStatus("sent")} disabled={!lead.draft && !body}>Mark sent</button>
            </>
          )}
        </div>
      </footer>
      ) : null}
      {!lead.draft && !contacts.length && !isWorking(lead.status) && lead.status !== "failed" ? (
        <CommandBlock commands={["# no draft yet — run the pipeline for this site", `npm run outreach -- redo ${lead.id}`]} />
      ) : null}
    </article>
  );
}

function Variant({ label, text }: { label: string; text: string }) {
  const [flash, setFlash] = useFlash();
  return (
    <div className="ox-variant">
      <div className="ox-variant-head">
        <span className="ox-field-label">{label}</span>
        <button
          type="button"
          className="ox-btn ox-btn-small ox-btn-quiet"
          onClick={() => navigator.clipboard.writeText(text).then(() => setFlash("Copied"), () => setFlash("Copy failed"))}
        >
          {flash ?? "Copy"}
        </button>
      </div>
      <p className="ox-variant-text">{text}</p>
    </div>
  );
}
