// Small pieces shared by the pages.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { followLink } from "../lib/router";
import { formatTicksAsTime } from "../lib/format";

export function Link({ href, className, children, title }: { href: string; className?: string; children: ReactNode; title?: string }) {
  return (
    <a href={href} className={className} title={title} onClick={(e) => followLink(e, href)}>
      {children}
    </a>
  );
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and insecure origins: fall back to a hidden selection.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      className={`btn btn-small ${state === "copied" ? "is-done" : ""} ${className}`}
      onClick={async () => {
        setState((await writeClipboard(text)) ? "copied" : "failed");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 1800);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </button>
  );
}

/** A labelled code block with a copy button. */
export function Snippet({ title, code, note }: { title: string; code: string; note?: ReactNode }) {
  return (
    <div className="snippet">
      <div className="snippet-head">
        <span>{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="snippet-code">{code}</pre>
      {note && <p className="snippet-note">{note}</p>}
    </div>
  );
}

export function Meter({ value, max, tone = "gold", marker }: { value: number; max: number; tone?: string; marker?: number }) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={`meter meter-${tone}`}>
      <div className="meter-fill" style={{ transform: `scaleX(${share})` }} />
      {marker !== undefined && max > 0 && <div className="meter-marker" style={{ left: `${Math.min(100, (marker / max) * 100)}%` }} />}
    </div>
  );
}

/** "0:42" until a tick, at the world's speed; "now" once due; the raw tick count on hover. */
export function Countdown({ until, tick, speed, paused }: { until: number; tick: number; speed: number; paused?: boolean }) {
  const left = until - tick;
  return (
    <span className={`countdown${paused ? " is-paused" : ""}`} title={`tick ${until} · ${Math.max(0, Math.ceil(left))} ticks`}>
      {left <= 0 ? "now" : formatTicksAsTime(left, speed)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {aside && <div className="section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
