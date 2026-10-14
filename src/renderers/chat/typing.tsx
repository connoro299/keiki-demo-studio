/**
 * Typing dots as a pure function of the elapsed typing time. Each dot rises and brightens in turn,
 * the way WhatsApp / Telegram / Slack pulse their indicators, without any CSS animation.
 */
const LOOP_MS = 1200;
const STAGGER_MS = 170;

export function typingDotPose(index: number, elapsedMs: number): { lift: number; alpha: number } {
  const local = elapsedMs - index * STAGGER_MS;
  const phase = (((local % LOOP_MS) + LOOP_MS) % LOOP_MS) / LOOP_MS;
  const window = 0.42;
  const wave = phase < window ? Math.sin((phase / window) * Math.PI) : 0;
  return { lift: wave, alpha: 0.4 + 0.6 * wave };
}

export function TypingDots({ elapsed, color, size, gap, rise = 2.6 }: { elapsed: number; color: string; size: number; gap: number; rise?: number }) {
  return (
    <span data-slot="chat-typing-dots" style={{ display: "inline-flex", alignItems: "center", gap }}>
      {[0, 1, 2].map((index) => {
        const pose = typingDotPose(index, elapsed);
        return (
          <span key={index} style={{ width: size, height: size, borderRadius: size / 2, background: color, opacity: pose.alpha, transform: `translateY(${(-pose.lift * rise).toFixed(2)}px)` }} />
        );
      })}
    </span>
  );
}
