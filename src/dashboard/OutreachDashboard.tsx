import { useCallback, useEffect, useState } from "react";
import type { Lead, XDraft } from "@/outreach/types";
import { api, type LeadsResponse } from "./client";
import { isWorking } from "./format";
import { LeadsView } from "./LeadsView";
import { XQueueView } from "./XQueueView";
import { Segmented } from "./ui";
import "./dashboard.css";

type Tab = "leads" | "x";

function readTab(): Tab {
  return new URLSearchParams(window.location.search).get("tab") === "x" ? "x" : "leads";
}

/** Review dashboard at /?view=outreach. Everything here is a draft; a person sends or posts it. */
export default function OutreachDashboard() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [leadsData, setLeadsData] = useState<LeadsResponse | null>(null);
  const [drafts, setDrafts] = useState<XDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshLeads = useCallback(async () => {
    try {
      setLeadsData(await api.leads());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  const refreshDrafts = useCallback(async () => {
    try {
      setDrafts((await api.drafts()).drafts);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    document.title = "Outreach · Keiki";
    const previous = document.body.style.background;
    document.body.classList.add("ox-body");
    void refreshLeads();
    void refreshDrafts();
    return () => {
      document.body.classList.remove("ox-body");
      document.body.style.background = previous;
    };
  }, [refreshLeads, refreshDrafts]);

  // Poll while the pipeline is working on something.
  const working = leadsData?.leads.some((lead) => isWorking(lead.status)) ?? false;
  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => void refreshLeads(), 4000);
    return () => window.clearInterval(id);
  }, [working, refreshLeads]);

  const switchTab = (next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("view", "outreach");
    if (next === "x") params.set("tab", "x");
    else params.delete("tab");
    window.history.replaceState(null, "", `?${params}`);
  };

  const replaceLead = (lead: Lead) =>
    setLeadsData((data) => (data ? { ...data, leads: data.leads.map((entry) => (entry.id === lead.id ? lead : entry)) } : data));
  const replaceDraft = (draft: XDraft) => setDrafts((list) => list?.map((entry) => (entry.id === draft.id ? draft : entry)) ?? list);

  const leads = leadsData?.leads ?? [];
  const ready = leads.filter((lead) => lead.status === "drafted").length;
  const inProgress = leads.filter((lead) => isWorking(lead.status)).length;
  const toReview = drafts?.filter((draft) => draft.status === "pending").length ?? 0;
  const posted = drafts?.filter((draft) => draft.status === "posted").length ?? 0;
  const sent = leads.filter((lead) => lead.status === "sent").length;

  return (
    <div className="ox">
      <header className="ox-header">
        <div className="ox-brand">
          <span className="ox-mark" aria-hidden />
          <span className="ox-title">Outreach</span>
        </div>
        <Segmented
          label="Queues"
          value={tab}
          onChange={switchTab}
          options={[
            { id: "leads", label: "Leads", count: ready },
            { id: "x", label: "X queue", count: toReview },
          ]}
        />
        <div className="ox-stats" aria-label="Summary">
          {tab === "leads" ? (
            <>
              <Stat value={ready} label="ready" />
              <Stat value={inProgress} label="in progress" />
              <Stat value={sent} label="sent" />
            </>
          ) : (
            <>
              <Stat value={toReview} label="to review" />
              <Stat value={drafts?.filter((d) => d.status === "approved").length ?? 0} label="approved" />
              <Stat value={posted} label="posted" />
            </>
          )}
        </div>
      </header>
      {error ? <div className="ox-banner" role="alert">{error}</div> : null}
      <main className="ox-main">
        {tab === "leads" ? (
          <LeadsView data={leadsData} onRefresh={refreshLeads} onLead={replaceLead} />
        ) : (
          <XQueueView drafts={drafts} onDraft={replaceDraft} />
        )}
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="ox-stat">
      <span className="ox-stat-value">{value}</span> {label}
    </span>
  );
}
