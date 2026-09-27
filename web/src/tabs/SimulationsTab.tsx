import React, { useState } from "react";
import { api, shortHash } from "../api";
import type { ScenarioReport } from "../types";
import { Chip, OkBadge, Panel, Spinner, useAsync } from "../ui";

export function SimulationsTab() {
  const { data, loading, reload } = useAsync(() => api.simulations().then((r) => r.data), [], 4000);
  const [running, setRunning] = useState<string>();
  const [expanded, setExpanded] = useState<string>();

  if (loading && !data) return <Spinner label="loading scenarios…" />;
  if (!data) return null;
  const { scenarios, reports } = data;
  const latest = (id: string) => reports.find((r) => r.scenarioId === id);

  const run = async (id: string) => {
    setRunning(id);
    try {
      await api.simulationRun(id);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(undefined);
    }
  };

  const runAll = async () => {
    for (const s of scenarios) {
      setRunning(s.id);
      try {
        await api.simulationRun(s.id);
      } catch {
        /* continue */
      }
    }
    setRunning(undefined);
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-[15px] font-bold text-white">Scenario Suite — corpus-defined, kernel-executed</h2>
        <span className="flex-1" />
        <button className="btn-neon" onClick={runAll} disabled={!!running}>
          {running ? `running ${running}…` : "Run all 10 scenarios"}
        </button>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {scenarios.map((s) => {
          const rep = latest(s.id);
          const isExpanded = expanded === s.id;
          return (
            <div key={s.id} className={`panel p-4 flex flex-col ${rep ? (rep.passed ? "border-ok/25" : "border-danger/30") : ""}`}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-bold text-neon">{s.id}</span>
                <span className="text-[12.5px] font-semibold text-slate-200 flex-1 truncate">{s.name}</span>
                {rep ? <OkBadge ok={rep.passed} okText="PASS" badText="FAIL" /> : <Chip tone="dim">not run</Chip>}
              </div>
              <p className="mt-2 text-[11.5px] text-slate-500 leading-relaxed flex-1">{s.description}</p>
              <div className="mt-3 flex items-center gap-2">
                <button className="btn-ghost px-2.5 py-1.5 text-[11.5px] flex-1" onClick={() => run(s.id)} disabled={running !== undefined}>
                  {running === s.id ? "running…" : "Run"}
                </button>
                {rep && (
                  <button className="btn-ghost px-2.5 py-1.5 text-[11.5px]" onClick={() => setExpanded(isExpanded ? "" : s.id)}>
                    {isExpanded ? "hide steps" : `steps (${rep.steps.length})`}
                  </button>
                )}
              </div>
              {isExpanded && rep && (
                <div className="mt-3 border-t border-edge/60 pt-3 space-y-1.5 max-h-64 overflow-auto">
                  {rep.steps.map((st) => (
                    <div key={st.i} className="flex items-start gap-2 text-[11px] font-mono">
                      <span className={`w-4 shrink-0 text-center ${st.ok ? "text-ok" : "text-danger"}`}>{st.ok ? "✓" : "✗"}</span>
                      <span className="text-slate-600 w-5 shrink-0">#{st.i}</span>
                      <span className="text-slate-300 flex-1 truncate">
                        {st.command ?? `verify:${st.verify}`}
                        {st.actor && <span className="text-slate-600"> · {st.actor}</span>}
                      </span>
                      <span className={st.ok ? "text-slate-500" : "text-danger"}>{st.got}</span>
                    </div>
                  ))}
                  <div className="pt-2 text-[10.5px] font-mono text-slate-600">
                    evidence <span className="text-neon-soft">{shortHash(rep.evidence, 14)}</span> · {rep.run}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {reports.length > 0 && (
        <Panel title={`Report History — ${reports.length}`} right={<Chip tone="dim">hashed evidence artifacts</Chip>}>
          <div className="overflow-auto -m-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Scenario</th>
                  <th>Run</th>
                  <th>Steps</th>
                  <th>Result</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {reports.slice(0, 25).map((r) => (
                  <tr key={r.reportId}>
                    <td className="text-slate-500">{r.reportId}</td>
                    <td className="text-neon-soft">
                      {r.scenarioId} <span className="text-slate-500">{r.name}</span>
                    </td>
                    <td className="text-slate-500">{r.run}</td>
                    <td className="text-slate-400">
                      {r.steps.filter((s) => s.ok).length}/{r.steps.length}
                    </td>
                    <td>
                      <OkBadge ok={r.passed} okText="PASS" badText="FAIL" />
                    </td>
                    <td className="text-slate-600">{shortHash(r.evidence, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
