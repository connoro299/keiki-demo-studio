import { useEffect, useMemo, useRef, useState } from "react";
import type { XDraft, XDraftStatus } from "@/outreach/types";
import { replyIntentUrl, tweetLength } from "@/outreach/x/tweets";
import { api, mediaUrl } from "./client";
import { relativeTime } from "./format";
import { DemoVideo, EmptyState, Segmented, StatusPill, useFlash } from "./ui";

type Filter = "pending" | "approved" | "posted" | "skipped" | "all";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "pending", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "posted", label: "Posted" },
  { id: "skipped", label: "Skipped" },
  { id: "all", label: "All" },
];

const STATUS_LABEL: Record<XDraftStatus, string> = { pending: "To review", approved: "Approved", posted: "Posted", skipped: "Skipped" };

export function XQueueView({ drafts, onDraft }: { drafts: XDraft[] | null; onDraft: (draft: XDraft) => void }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [activeId, setActiveId] = useState<string | null>(null);
  const sorted = useMemo(() => [...(drafts ?? [])].sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt)), [drafts]);
  // Keep a card that was just actioned in view until the filter changes, so the list doesn't jump under the cursor.
  const [sticky, setSticky] = useState<Set<string>>(new Set());
  useEffect(() => setSticky(new Set()), [filter]);
  const visible = sorted.filter((draft) => filter === "all" || draft.status === filter || sticky.has(draft.id));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, f.id === "all" ? sorted.length : sorted.filter((d) => d.status === f.id).length]));
  const active = visible.find((draft) => draft.id === activeId) ?? visible[0];

  const update = async (draft: XDraft, patch: { reply?: string; status?: XDraftStatus }) => {
    const next = await api.patchDraft(draft.id, patch);
    if (patch.status) setSticky((set) => new Set(set).add(draft.id));
    onDraft(next);
    return next;
  };

  const move = (delta: number) => {
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex((draft) => draft.id === active?.id));
    const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))];
    setActiveId(next.id);
    document.getElementById(`ox-card-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j") move(1);
      else if (event.key === "k") move(-1);
      else if (event.key === "s" && active && active.status !== "skipped") {
        void update(active, { status: "skipped" }).then(() => move(1));
      } else if (event.key === "e" && active) {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>(`#ox-card-${active.id} textarea`)?.focus();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (drafts === null) return <div className="ox-loading">Loading…</div>;

  return (
    <div className="ox-xqueue">
      <div className="ox-xqueue-bar">
        <Segmented label="Filter drafts" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: counts[f.id] }))} />
        <span className="ox-keys" aria-hidden>
          <kbd>j</kbd><kbd>k</kbd> move <kbd>e</kbd> edit <kbd>s</kbd> skip
        </span>
      </div>
      {sorted.length === 0 ? (
        <EmptyState
          title="The X queue is empty"
          commands={[
            "npm run x -- add https://x.com/<user>/status/<id>",
            "npm run x -- scan --preset all        # needs X_BEARER_TOKEN",
            "npm run x -- seed-fixtures             # sample data",
          ]}
        >
          Find people describing a problem an agent solves. Claude scores each tweet and drafts a reply; you edit it here and post it yourself. Nothing is posted automatically.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title={filter === "pending" ? "All caught up" : "Nothing here"}>
          {filter === "pending" ? "Every draft has been posted or skipped. Run another scan to find more." : "No drafts with this status."}
        </EmptyState>
      ) : (
        <ol className="ox-cards">
          {visible.map((draft) => (
            <DraftCard key={draft.id} draft={draft} active={draft.id === active?.id} onFocus={() => setActiveId(draft.id)} onUpdate={(patch) => update(draft, patch)} />
          ))}
        </ol>
      )}
    </div>
  );
}

function DraftCard({ draft, active, onFocus, onUpdate }: { draft: XDraft; active: boolean; onFocus: () => void; onUpdate: (patch: { reply?: string; status?: XDraftStatus }) => Promise<XDraft> }) {
  const [reply, setReply] = useState(draft.reply);
  const [alternatives, setAlternatives] = useState(draft.alternatives ?? []);
  const [flash, setFlash] = useFlash();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    setReply(draft.reply);
    setAlternatives(draft.alternatives ?? []);
  }, [draft.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const length = tweetLength(reply);
  const over = length > 280;
  const tweet = draft.tweet;

  const saveReply = (text: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onUpdate({ reply: text }).then(() => setFlash("Saved"), (err: Error) => setFlash(err.message));
    }, 600);
  };

  const swap = (index: number) => {
    const next = alternatives[index];
    const rest = alternatives.map((alt, i) => (i === index ? reply : alt));
    setReply(next);
    setAlternatives(rest);
    saveReply(next);
  };

  const replyOnX = () => {
    // Open synchronously so the browser treats it as a user gesture, then record it.
    window.open(replyIntentUrl(tweet.id, reply), "_blank", "noopener,noreferrer");
    window.clearTimeout(timer.current);
    onUpdate({ reply, status: "posted" }).then(() => setFlash("Marked posted"), (err: Error) => setFlash(err.message));
  };

  const initials = (tweet.authorName ?? tweet.authorHandle).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "@";

  return (
    <li id={`ox-card-${draft.id}`} className="ox-card" data-active={active ? "true" : undefined} data-status={draft.status} onFocusCapture={onFocus} onMouseDown={onFocus}>
      <div className="ox-card-main">
        <header className="ox-tweet-head">
          <span className="ox-avatar" aria-hidden>{initials}</span>
          <div className="ox-tweet-who">
            <span className="ox-tweet-name">{tweet.authorName ?? `@${tweet.authorHandle}`}</span>
            <span className="ox-tweet-handle">
              @{tweet.authorHandle}
              {tweet.createdAt ? <> · {relativeTime(tweet.createdAt)}</> : null}
              {tweet.authorFollowers !== undefined ? <> · {compact(tweet.authorFollowers)} followers</> : null}
            </span>
          </div>
          <span className="ox-score" title="Relevance score">{Math.round(draft.score * 100)}</span>
        </header>
        <p className="ox-tweet-text">{tweet.text}</p>
        <div className="ox-tweet-foot">
          <a href={tweet.url} target="_blank" rel="noreferrer">View on X ↗</a>
          {draft.site ? <a href={draft.site} target="_blank" rel="noreferrer">{draft.site.replace(/^https?:\/\//, "")}</a> : null}
          {draft.status !== "pending" ? <StatusPill status={draft.status} label={STATUS_LABEL[draft.status]} /> : null}
        </div>
        <p className="ox-reason">{draft.reason}</p>

        {draft.status === "skipped" && !draft.reply ? null : (
          <div className="ox-reply">
            <div className="ox-reply-head">
              <label htmlFor={`ox-reply-${draft.id}`} className="ox-field-label">Your reply</label>
              <span className="ox-counter" data-over={over ? "true" : undefined}>{length} / 280</span>
            </div>
            <textarea
              id={`ox-reply-${draft.id}`}
              className="ox-input ox-reply-input"
              rows={3}
              value={reply}
              onChange={(event) => {
                setReply(event.target.value);
                saveReply(event.target.value);
              }}
            />
            {alternatives.length ? (
              <div className="ox-alts">
                {alternatives.map((alt, index) => (
                  <button key={`${index}-${alt.slice(0, 16)}`} type="button" className="ox-alt" onClick={() => swap(index)} title="Use this reply instead">
                    <span className="ox-alt-text">{alt}</span>
                    <span className="ox-alt-use">Use</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <footer className="ox-card-actions">
          <span className="ox-flash" aria-live="polite">{flash ?? ""}</span>
          {draft.status === "skipped" || draft.status === "posted" ? (
            <button type="button" className="ox-btn" onClick={() => onUpdate({ status: "pending" })}>Move back to review</button>
          ) : (
            <>
              <button type="button" className="ox-btn ox-btn-quiet" onClick={() => onUpdate({ status: "skipped" })}>Skip</button>
              <button type="button" className="ox-btn ox-btn-primary" onClick={replyOnX} disabled={!reply.trim() || over}>Reply on X</button>
            </>
          )}
        </footer>
      </div>
      {draft.demo ? (
        <aside className="ox-card-demo">
          <DemoVideo src={draft.demo.mp4} poster={draft.demo.poster} label="Demo video" className="ox-phone-sm" />
          {draft.demo.mp4 ? <a className="ox-btn ox-btn-small" href={mediaUrl(draft.demo.mp4, true)} download>Download</a> : null}
          <span className="ox-demo-hint">Attach to the reply</span>
        </aside>
      ) : null}
    </li>
  );
}

function compact(value: number): string {
  return value >= 10000 ? `${Math.round(value / 1000)}K` : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(value);
}
