import React from "react";
import { api, timeAgo } from "../api";
import { Chip, JsonView, Panel, Spinner, useAsync } from "../ui";

const KIND_HINTS: Record<string, string> = {
  aggregate: "folded from event payloads by compiled reducers",
  census: "derived view of the live state registry",
  timeline: "bounded recent-event stream",
};

export function ProjectionsTab() {
  const { data, loading, reload } = useAsync(() => api.projections().then((r) => r.data), [], 4000);

  if (loading && !data) return <Spinner label="loading projections…" />;
  if (!data) return null;

  const entries = Object.entries(data).sort(([a], [b]) => (a < b ? -1 : 1));
  const aggregates = entries.filter(([, v]) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v as any).seq);
  const timelines = entries.filter(([, v]) => Array.isArray(v));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-[15px] font-bold text-white">Projection Layer — compiled reducers over the event log</h2>
        <span className="flex-1" />
        <button className="btn-ghost" onClick={reload}>
          refresh
        </button>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {aggregates.map(([id, value]) => {
          const v = value as Record<string, unknown>;
          const isCensus = Object.values(v).every((x) => typeof x === "number") && id.includes("census");
          return (
            <Panel key={id} title={id} right={<Chip tone={isCensus ? "gold" : "neon"}>{isCensus ? "census" : "aggregate"}</Chip>}>
              {isCensus ? (
                <div className="space-y-1.5">
                  {Object.entries(v).map(([k, n]) => (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-[11.5px] font-mono text-slate-400 flex-1 truncate">{k}</span>
                      <div className="flex-1 h-1.5 bg-abyss rounded-full overflow-hidden">
                        <div
                          className="h-full bg-neon/70 rounded-full"
                          style={{ width: `${Math.min(100, (Number(n) / Math.max(1, ...Object.values(v).map(Number))) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[12px] font-mono text-neon-soft w-8 text-right">{n as number}</span>
                    </div>
                  ))}
                  {Object.keys(v).length === 0 && <div className="text-[11px] font-mono text-slate-600">no entities yet</div>}
                </div>
              ) : (
                <JsonView value={v} max={60} />
              )}
              <div className="mt-2 text-[10px] font-mono text-slate-600">{KIND_HINTS[isCensus ? "census" : "aggregate"]}</div>
            </Panel>
          );
        })}

        {timelines.map(([id, value]) => {
          const v = value as { seq: number; ts: string; type: string; entityId: string; actor: string }[];
          return (
            <Panel key={id} title={id} right={<Chip tone="dim">{v.length} recent</Chip>}>
              <div className="space-y-1.5 max-h-72 overflow-auto pr-1">
                {v.length === 0 && <div className="text-[11px] font-mono text-slate-600">no events yet</div>}
                {[...v].reverse().map((e) => (
                  <div key={e.seq} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-slate-600 w-8 shrink-0">#{e.seq}</span>
                    <span className="text-neon-soft truncate flex-1">{e.type}</span>
                    <span className="text-slate-500 truncate max-w-[120px]">{e.entityId}</span>
                    <span className="text-slate-600 shrink-0">{timeAgo(e.ts)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] font-mono text-slate-600">{KIND_HINTS.timeline}</div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
