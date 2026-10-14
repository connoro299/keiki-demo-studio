import { useEffect, useRef, useState, type ReactNode } from "react";
import { mediaUrl } from "./client";
import { statusTone } from "./format";

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className="ox-pill" data-tone={statusTone(status)}>
      <span className="ox-pill-dot" aria-hidden />
      {label ?? status}
    </span>
  );
}

export function EmptyState({ title, children, commands }: { title: string; children?: ReactNode; commands?: string[] }) {
  return (
    <div className="ox-empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {commands?.length ? <CommandBlock commands={commands} /> : null}
    </div>
  );
}

export function CommandBlock({ commands }: { commands: string[] }) {
  return (
    <pre className="ox-code">
      {commands.map((command) => (
        <div key={command}>
          {command.startsWith("#") ? <span className="ox-code-comment">{command}</span> : <><span className="ox-code-prompt">$ </span>{command}</>}
        </div>
      ))}
    </pre>
  );
}

/** Muted looping demo video sized like a phone screen, with its poster while loading. */
export function DemoVideo({ src, poster, label, className }: { src?: string; poster?: string; label: string; className?: string }) {
  if (!src && !poster) return <div className={`ox-phone ox-phone-empty ${className ?? ""}`}>No video yet</div>;
  return (
    <div className={`ox-phone ${className ?? ""}`}>
      {src ? (
        <video src={mediaUrl(src)} poster={poster ? mediaUrl(poster) : undefined} autoPlay muted loop playsInline preload="metadata" aria-label={label} />
      ) : (
        <img src={mediaUrl(poster!)} alt={label} />
      )}
    </div>
  );
}

/** A short-lived confirmation like "Copied" or "Saved". */
export function useFlash(): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    text,
    (next: string) => {
      setText(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setText(null), 1600);
    },
  ];
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; label: string; count?: number }>; onChange: (id: T) => void; label: string }) {
  return (
    <div className="ox-segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} role="tab" aria-selected={value === option.id} className="ox-segment" onClick={() => onChange(option.id)} type="button">
          {option.label}
          {option.count !== undefined ? <span className="ox-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
