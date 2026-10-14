import { useEffect, useState } from "react";
import type { DemoChannel } from "@/contracts";
import type { FlowDocument } from "@/outreach/flow";
import { CHANNEL_LABELS } from "./client";
import { Phone } from "./Phone";
import { decodeShare, fetchShared } from "./share";
import "./studio.css";

/** What a demo link opens: the business's agent playing on a phone, and one line about Keiki. */
export function SharePage({ token, id }: { token?: string; id?: string }) {
  const [state, setState] = useState<{ flow: FlowDocument; channel: DemoChannel; name: string } | "error" | null>(null);
  const [playKey, setPlayKey] = useState(0);
  useEffect(() => { document.title = "Your agent · Keiki"; }, []);
  useEffect(() => {
    (id ? fetchShared(id) : Promise.resolve(token ?? "")).then(decodeShare).then(setState).catch(() => setState("error"));
  }, [token, id]);

  if (state === null) return <div className="st st-share" />;
  if (state === "error") {
    return (
      <div className="st st-share">
        <p className="st-sub">This demo link has expired or is incomplete. Ask whoever sent it for a fresh one.</p>
      </div>
    );
  }
  const width = Math.min(340, window.innerWidth - 48);
  return (
    <div className="st st-share">
      <div className="st-share-head">
        <h1 className="st-share-title">{state.name}, on {CHANNEL_LABELS[state.channel]}</h1>
        <p className="st-share-sub">What your customers would see texting your agent.</p>
      </div>
      <Phone flow={state.flow} channel={state.channel} width={width} playKey={playKey} />
      <div className="st-stage-actions">
        <button type="button" className="st-btn" onClick={() => setPlayKey(key => key + 1)}>Replay</button>
        <a className="st-btn st-btn-primary" href="https://onkeiki.com" target="_blank" rel="noreferrer">Get this agent</a>
      </div>
      <p className="st-share-foot">Made with <a href="https://onkeiki.com">Keiki</a></p>
    </div>
  );
}
