import React from "react";

const PILLS = [
  { label: "Deterministic Compiler", tone: "neon" },
  { label: "Event-Driven Kernel", tone: "ok" },
  { label: "Double-Entry Ledger", tone: "gold" },
  { label: "EIP-712 Attestations", tone: "web3" },
  { label: "Capability AuthZ", tone: "amber" },
];

export function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-x-0 h-32 bg-gradient-to-b from-transparent via-neon/[0.05] to-transparent scanline" />
      </div>

      <div className="relative w-full max-w-3xl text-center">
        <img src="/logo.png" alt="SOVR" className="w-52 h-52 mx-auto drop-shadow-[0_0_38px_rgba(51,224,255,0.35)]" />
        <h1 className="mt-8 text-5xl md:text-6xl font-extrabold tracking-tight text-white">
          SOVR <span className="text-neon drop-shadow-[0_0_18px_rgba(51,224,255,0.45)]">EMPIRE</span>
        </h1>
        <p className="mt-4 text-[13px] font-mono tracking-[0.28em] uppercase text-slate-400">
          AI Solutions Architecture · Financial Infrastructure · Web3 Protocol Engineering
        </p>

        <p className="mt-7 text-[15px] leading-relaxed text-slate-300 max-w-xl mx-auto">
          Engineering sovereign financial infrastructure from protocol definition to execution. The
          protocol is defined exclusively in YAML, compiled into closed executable authority, and run
          by a fail-closed kernel on an event-sourced, ledger-backed state.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {PILLS.map((p) => (
            <span key={p.label} className={`chip-${p.tone}`}>
              {p.label}
            </span>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-4">
          <button onClick={onEnter} className="btn-neon text-[15px] px-8 py-3">
            Enter Operating Console
            <span aria-hidden>→</span>
          </button>
        </div>

        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-3 text-left">
          {[
            ["YAML", "The exclusive protocol source — 9 machine-readable corpus files"],
            ["IR", "Canonical intermediate representation with staged fail-closed validation"],
            ["BUILD", "Sha256 build identity over every artifact; byte-identical reproducibility"],
            ["RUN", "Kernel executes compiled authority — zero runtime interpretation"],
          ].map(([k, v]) => (
            <div key={k} className="panel px-4 py-3">
              <div className="text-[11px] font-mono font-bold text-neon tracking-widest">{k}</div>
              <div className="mt-1 text-[11.5px] text-slate-400 leading-snug">{v}</div>
            </div>
          ))}
        </div>

        <p className="mt-12 text-[10.5px] font-mono text-slate-600 tracking-wider">
          GUSTAVO ORONA MALDONADO · FOUNDER, SOVR EMPIRE · SOVR.WORLD
        </p>
      </div>
    </div>
  );
}
