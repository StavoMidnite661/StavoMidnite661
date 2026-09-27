import React, { useEffect, useRef, useState } from "react";

export function Panel({
  title,
  right,
  children,
  className = "",
  glow = false,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <section className={`panel ${glow ? "panel-glow" : ""} ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3 border-b border-edge/70">
          <div className="h-title">{title}</div>
          <div className="flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "default" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "ok" | "bad" | "neon" | "gold" | "web3" }) {
  const color =
    tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : tone === "neon" ? "text-neon" : tone === "gold" ? "text-gold" : tone === "web3" ? "text-web3" : "text-slate-100";
  return (
    <div className="panel px-4 py-3.5">
      <div className="h-title">{label}</div>
      <div className={`mt-1.5 text-xl font-mono font-semibold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] font-mono text-slate-500">{sub}</div>}
    </div>
  );
}

export function Chip({ tone = "dim", children }: { tone?: "ok" | "bad" | "dim" | "neon" | "web3" | "gold" | "amber"; children: React.ReactNode }) {
  return <span className={`chip-${tone}`}>{children}</span>;
}

export function OkBadge({ ok, okText = "OK", badText = "FAIL" }: { ok: boolean; okText?: string; badText?: string }) {
  return ok ? <Chip tone="ok">{okText}</Chip> : <Chip tone="bad">{badText}</Chip>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-slate-400 text-[12.5px] font-mono py-8 justify-center">
      <span className="w-4 h-4 border-2 border-edge border-t-neon rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function Err({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-danger text-[12.5px] font-mono bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
      <span>⚠</span>
      <span>{msg}</span>
    </div>
  );
}

/** fetch-on-mount + optional interval polling; re-runs when `deps` change */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], intervalMs?: number): { data?: T; error?: string; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const d = await fnRef.current();
        if (alive) {
          setData(d);
          setError(undefined);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    let t: ReturnType<typeof setInterval> | undefined;
    if (intervalMs) t = setInterval(run, intervalMs);
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((x) => x + 1), loading };
}

export function Code({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <code className={`font-mono text-[12px] text-neon-soft bg-abyss border border-edge rounded px-1.5 py-0.5 ${className}`}>{children}</code>;
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-edge/40 last:border-0">
      <span className="text-[11.5px] font-sans text-slate-500 shrink-0">{k}</span>
      <span className="text-[12px] font-mono text-slate-200 text-right break-all">{v}</span>
    </div>
  );
}

export function JsonView({ value, max = 40 }: { value: unknown; max?: number }) {
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const full = JSON.stringify(value, null, 2) ?? "undefined";
    setText(expanded ? full : full.length > max * 4 ? full.slice(0, max * 4) + " …" : full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, expanded]);
  return (
    <div>
      <pre className="text-[11.5px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-72 overflow-auto bg-abyss/70 border border-edge/60 rounded-lg p-3">
        {text || "—"}
      </pre>
      {text.endsWith("…") && (
        <button className="mt-1.5 text-[11px] font-mono text-neon hover:underline" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "collapse" : "expand"}
        </button>
      )}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="h-title mb-2">{children}</div>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children?: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-slate-500 py-6 text-[12px] font-mono">
        {children ?? "— no data —"}
      </td>
    </tr>
  );
}
