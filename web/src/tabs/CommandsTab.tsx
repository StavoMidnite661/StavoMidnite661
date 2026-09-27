import React, { useMemo, useState } from "react";
import { api } from "../api";
import type { CommandDef, Receipt } from "../types";
import { Chip, EmptyRow, JsonView, KV, OkBadge, Panel, Spinner, useAsync } from "../ui";

function payloadToValues(spec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [f, t] of Object.entries(spec)) out[f] = t === "amount" || t === "int" ? "0" : t === "bool" ? "true" : "";
  return out;
}

export function CommandsTab() {
  const { data: commands, loading } = useAsync(() => api.commands().then((r) => r.data), []);
  const identities = useAsync(() => api.authz().then((r) => r.data.identities), []);
  const [selected, setSelected] = useState<CommandDef>();
  const [form, setForm] = useState<Record<string, string>>({});
  const [actor, setActor] = useState("operator");
  const [receipt, setReceipt] = useState<Receipt>();
  const [busy, setBusy] = useState(false);

  const current = commands?.find((c) => c.id === selected?.id);
  const cmd = current ?? selected;

  const exec = async () => {
    if (!cmd) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [f, t] of Object.entries(cmd.payload)) {
        const raw = form[f] ?? "";
        if (t === "amount" || t === "int") payload[f] = Number(raw);
        else if (t === "bool") payload[f] = raw === "true";
        else payload[f] = raw;
      }
      const r = await api.executeCommand(cmd.id, actor, payload);
      setReceipt(r.data);
    } catch (e) {
      setReceipt(undefined);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !commands) return <Spinner label="loading command authority…" />;

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      <Panel title={`Compiled Commands — ${commands?.length ?? 0}`} right={<Chip tone="neon">from YAML</Chip>}>
        <div className="space-y-1 max-h-[calc(100vh-220px)] overflow-auto pr-1">
          {(commands ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setSelected(c);
                setForm(payloadToValues(c.payload));
                setReceipt(undefined);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                cmd?.id === c.id ? "border-neon/50 bg-neon/10" : "border-transparent hover:bg-panel2"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-mono font-semibold ${cmd?.id === c.id ? "text-neon" : "text-slate-200"}`}>{c.id}</span>
                <span className="text-[10px] font-mono text-slate-600">{c.domain}</span>
                {c.ledger && <Chip tone="gold">ledger</Chip>}
                {c.verify && <Chip tone="web3">attested</Chip>}
                {(c.gates ?? []).length > 0 && <Chip tone="amber">{(c.gates ?? []).length} gate(s)</Chip>}
              </div>
              <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">{c.description}</div>
            </button>
          ))}
        </div>
      </Panel>

      <div className="space-y-5">
        {cmd ? (
          <>
            <Panel title={cmd.name} right={<Chip tone="dim">{cmd.domain}</Chip>}>
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5">
                <KV k="Capabilities" v={cmd.capabilities.join(", ")} />
                <KV k="Emits" v={cmd.emits.map((e) => e.event).join(", ")} />
                {cmd.sourceInstance && <KV k="Source" v={`${cmd.sourceInstance.machine} (${cmd.sourceInstance.alias})`} />}
                {cmd.creates && <KV k="Creates" v={cmd.creates.machine} />}
                {(cmd.gates ?? []).length > 0 && <KV k="Gates" v={(cmd.gates ?? []).map((g) => g.id).join(", ")} />}
                {cmd.ledger && <KV k="Ledger effect" v={cmd.ledger.kind} />}
                {cmd.authz && <KV k="Authz effect" v={cmd.authz.kind} />}
                {cmd.verify && <KV k="Verification" v={`${cmd.verify.kind} · ${Object.keys(cmd.verify.fields).length} typed field(s)`} />}
              </div>
            </Panel>

            <Panel title="Execution Console" right={<Chip tone="ok">dispatched through kernel</Chip>}>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Actor (identity)</label>
                  <select className="input" value={actor} onChange={(e) => setActor(e.target.value)}>
                    {(identities.data ?? []).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.id} — {i.name}
                        {i.constitutional ? " ⚖" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="hidden md:block" />
                {Object.entries(cmd.payload).map(([f, t]) => (
                  <div key={f}>
                    <label className="label">
                      {f} <span className="text-slate-600 normal-case">({t})</span>
                    </label>
                    <input
                      className="input"
                      value={form[f] ?? ""}
                      onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                      placeholder={t === "amount" ? "amount in μSOVR" : undefined}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button className="btn-neon" onClick={exec} disabled={busy}>
                  {busy ? "executing…" : `Execute ${cmd.id}`}
                </button>
                <span className="text-[11px] font-mono text-slate-600">authz → validation → gates → state → verify → ledger → events</span>
              </div>
            </Panel>

            {receipt && (
              <Panel
                title="Execution Receipt"
                right={
                  <div className="flex items-center gap-2">
                    <OkBadge ok={receipt.ok} okText={receipt.code} badText={receipt.code} />
                    <Chip tone="dim">{receipt.durationMs} ms</Chip>
                    <Chip tone="dim">{receipt.id}</Chip>
                  </div>
                }
              >
                {!receipt.ok && receipt.reason && (
                  <div className="mb-3 text-[12px] font-mono text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{receipt.reason}</div>
                )}
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5">
                  {receipt.stages.map((s, i) => (
                    <KV key={i} k={s.name} v={<span className={s.ok ? "text-ok" : "text-danger"}>{s.ok ? "✓" : "✗"} {s.detail ?? ""}</span>} />
                  ))}
                </div>
                {receipt.events.length > 0 && (
                  <div className="mt-3">
                    <div className="h-title mb-2">Emitted events</div>
                    <div className="flex flex-wrap gap-1.5">
                      {receipt.events.map((e) => (
                        <Chip key={e.seq} tone="neon">
                          #{e.seq} {e.type}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
                {receipt.ledgerOps.length > 0 && (
                  <div className="mt-3">
                    <div className="h-title mb-2">Ledger / authz effects</div>
                    <JsonView value={receipt.ledgerOps} />
                  </div>
                )}
              </Panel>
            )}
          </>
        ) : (
          <Panel title="Select a command">
            <div className="text-[12px] font-mono text-slate-500 py-6 text-center">select a command from the compiled authority to inspect and execute it</div>
          </Panel>
        )}
      </div>
    </div>
  );
}
