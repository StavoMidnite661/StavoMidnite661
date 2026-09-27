import React, { useEffect, useState } from "react";
import { api, subscribe, shortHash } from "./api";
import { OverviewTab } from "./tabs/OverviewTab";
import { ProtocolTab } from "./tabs/ProtocolTab";
import { CompilerTab } from "./tabs/CompilerTab";
import { CommandsTab } from "./tabs/CommandsTab";
import { StateTab } from "./tabs/StateTab";
import { EventsTab } from "./tabs/EventsTab";
import { LedgerTab } from "./tabs/LedgerTab";
import { AuthzTab } from "./tabs/AuthzTab";
import { Web3Tab } from "./tabs/Web3Tab";
import { SimulationsTab } from "./tabs/SimulationsTab";
import { ProjectionsTab } from "./tabs/ProjectionsTab";

const TABS = [
  ["overview", "Overview"],
  ["protocol", "Protocol"],
  ["compiler", "Compiler"],
  ["commands", "Commands"],
  ["state", "State"],
  ["events", "Events"],
  ["ledger", "Ledger"],
  ["authz", "AuthZ"],
  ["web3", "Web3"],
  ["simulations", "Simulations"],
  ["projections", "Projections"],
] as const;

type TabId = (typeof TABS)[number][0];

export function Console({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<TabId>("overview");
  const [live, setLive] = useState<{ last?: { kind: string; at: number }; online: boolean }>({ online: true });
  const [flash, setFlash] = useState<string>();

  useEffect(() => {
    const off = subscribe((msg) => {
      setLive((l) => ({ ...l, online: true, last: { kind: msg.kind, at: Date.now() } }));
      if (msg.kind === "receipt" && (msg as any).receipt) {
        const rc = (msg as any).receipt;
        setFlash(`${rc.ok ? "✓" : "✗"} ${rc.command} → ${rc.code}`);
        setTimeout(() => setFlash(undefined), 4000);
      }
      if (msg.kind === "reset") setFlash("state reset — genesis restored");
    });
    return off;
  }, []);

  const reset = async () => {
    if (!confirm("Reset the entire runtime state? Event log, ledger and grants return to genesis.")) return;
    try {
      await api.reset();
      setFlash("reset complete");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-void/85 backdrop-blur-md border-b border-edge">
        <div className="max-w-[1440px] mx-auto px-5 py-3 flex items-center gap-4">
          <button onClick={onExit} className="flex items-center gap-3 group" title="Back to landing">
            <img src="/logo.png" alt="SOVR" className="w-9 h-9 rounded-lg drop-shadow-[0_0_14px_rgba(51,224,255,0.4)]" />
            <div className="text-left leading-tight">
              <div className="text-[15px] font-extrabold tracking-wide text-white group-hover:text-neon transition-colors">
                SOVR <span className="text-neon">EMPIRE</span>
              </div>
              <div className="text-[9.5px] font-mono tracking-[0.22em] uppercase text-slate-500">Protocol Operating Console</div>
            </div>
          </button>

          <div className="flex-1" />

          <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-slate-400">
            <span className={`dot ${live.online ? "bg-ok shadow-[0_0_8px_rgba(0,255,157,0.8)]" : "bg-danger"} ${live.last ? "pulse" : ""}`} />
            <span>{live.online ? "LIVE" : "OFFLINE"}</span>
            {live.last && <span className="text-slate-600">· last: {live.last.kind}</span>}
          </div>

          {flash && (
            <div className="hidden lg:block font-mono text-[11px] text-neon-soft bg-neon/10 border border-neon/30 rounded-lg px-3 py-1.5 max-w-[340px] truncate">
              {flash}
            </div>
          )}

          <button onClick={reset} className="btn-danger px-3 py-1.5 text-[12px]">
            Reset
          </button>
        </div>

        <nav className="max-w-[1440px] mx-auto px-5 flex gap-1 overflow-x-auto">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3.5 py-2.5 text-[12px] font-semibold tracking-wide border-b-2 transition-colors whitespace-nowrap ${
                tab === id ? "border-neon text-neon" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 w-full max-w-[1440px] mx-auto px-5 py-5">
        {tab === "overview" && <OverviewTab />}
        {tab === "protocol" && <ProtocolTab />}
        {tab === "compiler" && <CompilerTab />}
        {tab === "commands" && <CommandsTab />}
        {tab === "state" && <StateTab />}
        {tab === "events" && <EventsTab />}
        {tab === "ledger" && <LedgerTab />}
        {tab === "authz" && <AuthzTab />}
        {tab === "web3" && <Web3Tab />}
        {tab === "simulations" && <SimulationsTab />}
        {tab === "projections" && <ProjectionsTab />}
      </main>

      <footer className="border-t border-edge/60 py-3">
        <div className="max-w-[1440px] mx-auto px-5 flex items-center justify-between text-[10.5px] font-mono text-slate-600">
          <span>SOVR EMPIRE · YAML-DEFINED · COMPILED-EXECUTED · EVENT-SOURCED</span>
          <span>kernel executes compiled authority — zero runtime interpretation</span>
        </div>
      </footer>
    </div>
  );
}
