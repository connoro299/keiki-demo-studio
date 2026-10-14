import { useEffect, useMemo } from "react";
import { applyChannel, compileDemo, validateDemo } from "@/compiler";
import type { DemoChannel, DemoFlow } from "@/contracts";
import { DemoPlayer } from "@/player/DemoPlayer";

const SCREEN_W = 402;
const SCREEN_H = 874;

/** A scaled iPhone running the real demo player. `playKey` restarts playback from the top. */
export function Phone({ flow, channel, width = 280, playKey = 0, autoplay = true }: { flow: Record<string, unknown>; channel: DemoChannel; width?: number; playKey?: number; autoplay?: boolean }) {
  const compiled = useMemo(() => {
    const { targets: _targets, checkpoints: _checkpoints, ...demo } = flow;
    const result = validateDemo(demo as DemoFlow);
    if (!result.ok) return null;
    return applyChannel(compileDemo(result.demo), channel);
  }, [flow, channel]);

  useEffect(() => {
    if (!compiled || !autoplay) return;
    const timer = window.setTimeout(() => {
      const api = window.IMESSAGE_DEMO;
      if (api) void api.reset().then(() => api.play());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [compiled, playKey, autoplay]);

  const scale = (width - 16) / SCREEN_W;
  return (
    <div className="st-phone" style={{ width, height: SCREEN_H * scale + 16 }}>
      <div className="st-phone-glass" style={{ width: SCREEN_W * scale, height: SCREEN_H * scale }}>
        {compiled ? (
          <div style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            <DemoPlayer key={`${compiled.id}-${channel}`} compiled={compiled} clean />
          </div>
        ) : (
          <div className="st-phone-empty">This conversation couldn't be played.</div>
        )}
      </div>
    </div>
  );
}
