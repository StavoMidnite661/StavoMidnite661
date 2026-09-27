import React, { useState } from "react";
import { api } from "../api";
import { Chip, EmptyRow, JsonView, Panel, Spinner, useAsync } from "../ui";

export function StateTab() {
  const { data, loading } = useAsync(() => api.state().then((r) => r.data), [], 4000);
  const [machine, setMachine] = useState<string>("all");
  const [sel, setSel] = useState<string>();

  if (loading && !data) return <Spinner label="loading live state…" />;
  if (!data) return null;

  const instances = data.instances.filter((i) => machine === "all" || i.machine === machine);
  const machines = Object.values(data.machines);
  const selected = data.instances.find((i) => i.id === sel);

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-4 gap-3">
        {machines.map((m) => {
          const n = data.counts[m.id] ?? 0;
          return (
            <button
              key={m.id}
              onClick={() => setMachine(machine === m.id ? "all" : m.id)}
              className={`panel px-4 py-3 text-left transition-colors ${machine === m.id ? "border-neon/60 bg-neon/[0.07]" : "hover:border-edge2"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono font-semibold text-slate-200">{m.id}</span>
                <span className={`text-lg font-mono font-bold ${machine === m.id ? "text-neon" : "text-slate-300"}`}>{n}</span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-500">
                initial <span className="text-slate-400">{m.initial}</span> · terminal {m.terminal.join(", ")}
              </div>
            </button>
          );
        })}
      </div>

      <Panel title={`Live State — ${instances.length} instance(s)`} right={<Chip tone="neon">reconstructed from events</Chip>}>
        <div className="overflow-auto max-h-[calc(100vh-300px)] -m-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Machine</th>
                <th>State</th>
                <th>Data fields</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {instances.length === 0 && <EmptyRow colSpan={5}>no instances — run commands or a simulation</EmptyRow>}
              {instances.map((i) => (
                <tr key={i.id} onClick={() => setSel(i.id)} className="cursor-pointer">
                  <td className="text-neon-soft">{i.id}</td>
                  <td className="text-slate-400">{i.machine}</td>
                  <td>
                    <Chip tone={data.machines[i.machine]?.terminal?.includes(i.state) ? "bad" : "ok"}>{i.state}</Chip>
                  </td>
                  <td className="text-slate-500 max-w-[320px] truncate">
                    {Object.keys(i.data ?? {}).length ? Object.entries(i.data).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v)}`).join("  ") : "—"}
                  </td>
                  <td className="text-slate-600">{i.createdAt ? new Date(i.createdAt).toLocaleTimeString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {selected && (
        <div className="grid lg:grid-cols-2 gap-5">
          <Panel title={`Instance — ${selected.id}`} right={<Chip tone={data.machines[selected.machine]?.terminal?.includes(selected.state) ? "bad" : "ok"}>{selected.state}</Chip>}>
            <JsonView value={selected.data ?? {}} />
          </Panel>
          <Panel title={`State machine — ${selected.machine}`}>
            <div className="space-y-1.5">
              {(data.machines[selected.machine]?.transitions ?? []).map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-[11.5px] font-mono">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${(t.from ?? []).includes(selected.state) ? "bg-neon shadow-[0_0_8px_rgba(51,224,255,0.8)]" : "bg-edge"}`} />
                  <span className="text-slate-400 w-44 truncate">{t.event}</span>
                  <span className="text-slate-500">[{(t.from ?? []).join(", ")}]</span>
                  <span className="text-slate-600">→</span>
                  <span className={t.to === selected.state ? "text-neon" : "text-slate-300"}>{t.to}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
