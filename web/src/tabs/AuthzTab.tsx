import React, { useState } from "react";
import { api } from "../api";
import type { Receipt } from "../types";
import { Chip, EmptyRow, OkBadge, Panel, Spinner, useAsync } from "../ui";

export function AuthzTab() {
  const { data, loading, reload } = useAsync(() => api.authz().then((r) => r.data), [], 4000);
  const [actor, setActor] = useState("operator");
  const [target, setTarget] = useState("client-02");
  const [capability, setCapability] = useState("ledger:transfer");
  const [receipt, setReceipt] = useState<Receipt>();
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Spinner label="loading capability matrix…" />;
  if (!data) return null;

  const caps = Object.keys(data.capabilities).sort();
  const ids = data.identities.map((i) => i.id).sort();

  const mutate = async (kind: "grant" | "revoke") => {
    setBusy(true);
    try {
      const r = kind === "grant" ? await api.authzGrant(actor, target, capability) : await api.authzRevoke(actor, target, capability);
      setReceipt(r.data.receipt);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <Panel title="Capability Matrix — identity × capability" right={<Chip tone="web3">fail-closed</Chip>}>
          <div className="overflow-auto max-h-[560px] -m-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Capability</th>
                  {ids.map((id) => (
                    <th key={id} className="!text-center">
                      {id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {caps.map((cap) => (
                  <tr key={cap}>
                    <td>
                      <div className="text-neon-soft">{cap}</div>
                      <div className="text-[10px] text-slate-600">{data.capabilities[cap]?.description ?? ""}</div>
                    </td>
                    {ids.map((id) => (
                      <td key={id} className="text-center">
                        {data.matrix[cap]?.[id] ? (
                          <span className="text-ok">●</span>
                        ) : (
                          <span className="text-edge">○</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="Grant / Revoke" right={<Chip tone="ok">kernel-dispatched</Chip>}>
            <div className="space-y-3">
              <div>
                <label className="label">Actor (must hold authz:grant or be constitutional)</label>
                <select className="input" value={actor} onChange={(e) => setActor(e.target.value)}>
                  {ids.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Target identity</label>
                <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {ids.map((id) => (
                    <option key={id} value={id}>
                      {id}
                      {data.identities.find((i) => i.id === id)?.constitutional ? " ⚖ immutable" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Capability</label>
                <select className="input" value={capability} onChange={(e) => setCapability(e.target.value)}>
                  {caps.map((c) => (
                    <option key={c} value={c}>
                      {c}
                      {data.capabilities[c]?.meta ? " (meta)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button className="btn-ok flex-1" disabled={busy} onClick={() => mutate("grant")}>
                  Grant
                </button>
                <button className="btn-danger flex-1" disabled={busy} onClick={() => mutate("revoke")}>
                  Revoke
                </button>
              </div>
              <p className="text-[10.5px] font-mono text-slate-600 leading-relaxed">
                G-005: meta grants (authz:grant) are restricted to the constitutional identity. Constitutional identities are immutable.
              </p>
            </div>
          </Panel>

          <Panel title="Genesis Grants" right={<Chip tone="dim">{data.grants.length}</Chip>}>
            <div className="space-y-1 max-h-44 overflow-auto pr-1">
              {data.grants.map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-slate-400 w-16 truncate">{g.identity}</span>
                  <span className="text-slate-600">←</span>
                  <span className="text-neon-soft flex-1 truncate">{g.capability}</span>
                  <span className="text-slate-600">{g.grantedBy}</span>
                </div>
              ))}
              {data.grants.length === 0 && <EmptyRow colSpan={1} />}
            </div>
          </Panel>
        </div>
      </div>

      {receipt && (
        <Panel title="Mutation Receipt" right={<OkBadge ok={receipt.ok} okText={receipt.code} badText={receipt.code} />}>
          {!receipt.ok && receipt.reason && <div className="text-[12px] font-mono text-danger mb-2">{receipt.reason}</div>}
          <div className="flex flex-wrap gap-1.5">
            {receipt.stages.map((s, i) => (
              <Chip key={i} tone={s.ok ? "ok" : "bad"}>
                {s.name}: {s.ok ? "✓" : "✗"}
              </Chip>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
