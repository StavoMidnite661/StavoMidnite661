import React, { useState } from "react";
import { api, shortHash } from "../api";
import type { StoredEvent } from "../types";
import { Chip, EmptyRow, JsonView, OkBadge, Panel, Spinner, useAsync } from "../ui";

export function EventsTab() {
  const { data, loading, reload } = useAsync(() => api.events(200).then((r) => r.data), [], 4000);
  const [verify, setVerify] = useState<any>();
  const [replay, setReplay] = useState<any>();
  const [sel, setSel] = useState<StoredEvent>();
  const [filter, setFilter] = useState("");

  const runVerify = async () => setVerify((await api.eventsVerify()).data);
  const runReplay = async () => setReplay((await api.eventsReplay()).data);

  if (loading && !data) return <Spinner label="loading event log…" />;
  if (!data) return null;

  const events = data.events.filter((e) => !filter || e.type.toLowerCase().includes(filter.toLowerCase()) || e.entityId.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-3 gap-3">
        <Panel title="Hash Chain" right={verify && <OkBadge ok={verify.ok} okText="VERIFIED" badText={`BROKEN @ ${verify.brokenAt}`} />}>
          <div className="flex items-center gap-3">
            <button className="btn-neon flex-1" onClick={runVerify}>
              {verify ? `✓ ${verify.checked} events verified` : "Verify chain"}
            </button>
            <button className="btn-ghost flex-1" onClick={runReplay}>
              {replay ? (replay.ok ? "replay matches" : "replay diverged") : "Replay & compare"}
            </button>
            <a className="btn-ghost flex-1" href={api.eventsExportUrl()} download="sovr-events.jsonl">
              Export JSONL
            </a>
          </div>
          {replay && (
            <div className="mt-3 text-[11px] font-mono text-slate-500 space-y-1">
              <div>
                {replay.events} events · rebuilt {replay.rebuilt.replayed}
              </div>
              <div className="truncate">
                live <span className="text-neon-soft">{replay.live}</span>
              </div>
              <div className="truncate">
                replayed <span className={replay.ok ? "text-neon-soft" : "text-danger"}>{replay.replayed}</span>
              </div>
            </div>
          )}
        </Panel>
        <div className="md:col-span-2 panel px-4 py-3.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="h-title">Append-Only Log — {data.total} events</div>
            <div className="flex items-center gap-2">
              <input className="input !w-56 !py-1.5" placeholder="filter by type or entity…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button className="btn-ghost px-2.5 py-1.5 text-[11px]" onClick={reload}>
                refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <Panel title={`Events — ${events.length} shown`}>
        <div className="overflow-auto max-h-[calc(100vh-330px)] -m-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>Seq</th>
                <th>Type</th>
                <th>Entity</th>
                <th>Actor</th>
                <th>Affected</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && <EmptyRow colSpan={6} />}
              {events.map((e) => (
                <tr key={e.seq} onClick={() => setSel(e)} className="cursor-pointer">
                  <td className="text-slate-500">#{e.seq}</td>
                  <td>
                    <span className={e.type === "SystemGenesis" ? "text-gold" : e.type.startsWith("Command") || e.type === "AuthorizationDenied" ? "text-amber" : "text-neon-soft"}>
                      {e.type}
                    </span>
                  </td>
                  <td className="text-slate-400">{e.entityId}</td>
                  <td className="text-slate-500">{e.actor}</td>
                  <td className="text-slate-500">{e.affected?.map((a) => a.id).join(", ") || "—"}</td>
                  <td className="text-slate-600">{shortHash(e.hash, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {sel && (
        <Panel title={`Event #${sel.seq} — ${sel.type}`} right={<Chip tone="dim">{new Date(sel.ts).toLocaleString()}</Chip>}>
          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <div className="h-title mb-2">Payload</div>
              <JsonView value={sel.payload} />
            </div>
            <div className="space-y-3">
              <div>
                <div className="h-title mb-2">Chain proof</div>
                <div className="text-[11px] font-mono space-y-1.5 bg-abyss/70 border border-edge/60 rounded-lg p-3">
                  <div>
                    <span className="text-slate-500">prev </span>
                    <span className="text-slate-400">{sel.prevHash}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">hash </span>
                    <span className="text-neon-soft">{sel.hash}</span>
                  </div>
                  <div className="text-slate-600">hash = sha256(seq, ts, type, entityId, actor, payload, affected, prevHash)</div>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
