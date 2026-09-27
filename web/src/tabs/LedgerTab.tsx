import React from "react";
import { api, fmtAmount } from "../api";
import { Chip, EmptyRow, OkBadge, Panel, Spinner, useAsync } from "../ui";

export function LedgerTab() {
  const { data, loading, reload } = useAsync(() => api.ledger().then((r) => r.data), [], 4000);

  if (loading && !data) return <Spinner label="loading ledger…" />;
  if (!data) return null;
  const { accounts, transfers, verify, genesisSupply } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Panel>
          <div className="h-title">Genesis Supply</div>
          <div className="mt-1.5 font-mono text-lg font-semibold text-gold">{fmtAmount(genesisSupply, 0)}</div>
        </Panel>
        <Panel>
          <div className="h-title">Accounts</div>
          <div className="mt-1.5 font-mono text-lg font-semibold text-slate-100">{accounts.length}</div>
        </Panel>
        <Panel>
          <div className="h-title">Transfers</div>
          <div className="mt-1.5 font-mono text-lg font-semibold text-slate-100">{transfers.length}</div>
        </Panel>
        <Panel>
          <div className="h-title">Double-Entry</div>
          <div className="mt-2">
            <OkBadge ok={verify.doubleEntry} okText="BALANCED" badText="IMBALANCED" />
          </div>
        </Panel>
        <Panel>
          <div className="h-title">Supply Invariant</div>
          <div className="mt-2">
            <OkBadge ok={verify.supplyInvariant} okText="HELD" badText="BROKEN" />
            <div className="mt-1.5 text-[11px] font-mono text-slate-500">Σ balances = {fmtAmount(verify.totalBalance, 0)}</div>
          </div>
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Panel title="Accounts" right={<Chip tone="gold">TigerBeetle-style boundary</Chip>}>
          <div className="overflow-auto max-h-[520px] -m-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Code</th>
                  <th>Owner</th>
                  <th>Opening</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="text-neon-soft">{a.id}</div>
                      <div className="text-[10px] text-slate-600">{a.name}</div>
                    </td>
                    <td className="text-slate-500">{a.code}</td>
                    <td className="text-slate-500">{a.userId}</td>
                    <td className="text-slate-400">{fmtAmount(a.opening, 0)}</td>
                    <td className={a.userId === "ledger-boundary" && a.id === "reserve" ? "text-gold" : "text-slate-200"}>{fmtAmount(a.balance ?? 0, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Transfers (latest 100)" right={<Chip tone="dim">{transfers.length} total</Chip>}>
          <div className="overflow-auto max-h-[520px] -m-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>From → To</th>
                  <th>Amount</th>
                  <th>Memo</th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 && <EmptyRow colSpan={4}>no transfers yet</EmptyRow>}
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="text-slate-500">{t.id}</td>
                    <td>
                      <span className="text-slate-400">{t.source}</span>
                      <span className="text-slate-600 mx-1.5">→</span>
                      <span className="text-slate-400">{t.destination}</span>
                    </td>
                    <td className="text-slate-200">{fmtAmount(t.amount, 0)}</td>
                    <td className="text-slate-500">{t.memo || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
