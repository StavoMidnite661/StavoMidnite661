import React from "react";
import { api, fmtAmount, shortHash, timeAgo } from "../api";
import { Chip, KV, OkBadge, Panel, Spinner, Stat, useAsync } from "../ui";

export function OverviewTab() {
  const { data, error, loading, reload } = useAsync(() => api.overview().then((r) => r.data), [], 5000);

  if (loading && !data) return <Spinner label="connecting to kernel…" />;
  if (error && !data) return <div className="text-danger font-mono text-sm">{error}</div>;
  if (!data) return null;
  const { build, counts, integrity, supply, recent, countsByMachine } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Build Identity" value={<span className="text-[13px]">{shortHash(build.identity, 8)}</span>} sub="sha256 over all artifacts" tone="neon" />
        <Stat label="Corpus Hash" value={<span className="text-[13px]">{shortHash(build.corpusHash, 8)}</span>} sub={`${build.protocol} v${build.version}`} />
        <Stat label="Events" value={counts.events} sub="hash-chained log" />
        <Stat label="Entities" value={counts.entities} sub="live state" />
        <Stat label="Transfers" value={counts.transfers} sub="double-entry ledger" tone="gold" />
        <Stat label="Grants / Denials" value={`${counts.grants} / ${counts.denials}`} sub="capability authz" tone="web3" />
        <Stat label="Chain Integrity" value={<OkBadge ok={integrity.chain.ok} okText="VERIFIED" badText="BROKEN" />} sub={`${integrity.chain.checked} events checked`} tone={integrity.chain.ok ? "ok" : "bad"} />
        <Stat label="Supply Invariant" value={<OkBadge ok={integrity.ledger.supplyInvariant} okText="HELD" badText="BROKEN" />} sub={fmtAmount(supply.total)} tone={integrity.ledger.supplyInvariant ? "ok" : "bad"} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Protocol Surface" right={<Chip tone="neon">YAML-compiled</Chip>}>
          <KV k="Protocol" v={`${build.protocol} v${build.version}`} />
          <KV k="Unit" v={`${build.unit.name} (1 SOVR = ${build.unit.base.toLocaleString()} μ)`} />
          <KV k="Compiled at" v={new Date(build.compiledAt).toLocaleString()} />
          <KV k="Registry artifacts" v={build.artifacts} />
          <KV k="Generated modules" v={build.generated} />
          <div className="mt-3">
            <div className="h-title mb-2">Entities by machine</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(countsByMachine).map(([m, n]) => (
                <Chip key={m} tone="dim">
                  {m} · {n}
                </Chip>
              ))}
              {Object.keys(countsByMachine).length === 0 && <span className="text-[11px] font-mono text-slate-600">genesis — no entities yet</span>}
            </div>
          </div>
        </Panel>

        <Panel title="Ledger Boundary" right={<Chip tone="gold">{fmtAmount(supply.genesis, 0)}</Chip>}>
          <KV k="Genesis supply" v={fmtAmount(supply.genesis, 0)} />
          <KV k="Reserve balance" v={fmtAmount(supply.reserve, 0)} />
          <KV k="Total balance (all accounts)" v={fmtAmount(supply.total, 0)} />
          <KV k="Ledger accounts" v={counts.ledgerAccounts} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              ["Double-entry", integrity.ledger.doubleEntry],
              ["Balances match", integrity.ledger.balancesMatch],
              ["Supply invariant", integrity.ledger.supplyInvariant],
            ].map(([label, ok]) => (
              <div key={label as string} className="panel2 bg-abyss/60 border border-edge/60 rounded-lg py-2">
                <div className="text-[10px] font-sans uppercase tracking-wider text-slate-500">{label}</div>
                <div className={`mt-1 font-mono text-[13px] font-bold ${(ok as boolean) ? "text-ok" : "text-danger"}`}>{(ok as boolean) ? "✓" : "✗"}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Runtime" right={<Chip tone="ok">operational</Chip>}>
          <KV k="Started" v={new Date(data.startedAt).toLocaleString()} />
          <KV k="Web3 keys" v={counts.keys} />
          <KV k="Recent receipts" v={recent.receipts.length} />
          <div className="mt-3">
            <div className="h-title mb-2">Recent activity</div>
            <div className="space-y-1.5 max-h-56 overflow-auto pr-1">
              {recent.events.length === 0 && <div className="text-[11px] font-mono text-slate-600">genesis only</div>}
              {recent.events.slice(0, 8).map((e) => (
                <div key={e.seq} className="flex items-center gap-2 text-[11.5px] font-mono">
                  <span className="text-slate-600 w-8 shrink-0">#{e.seq}</span>
                  <span className="text-neon-soft truncate">{e.type}</span>
                  <span className="text-slate-500 truncate flex-1">{e.entityId}</span>
                  <span className="text-slate-600 shrink-0">{timeAgo(e.ts)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
