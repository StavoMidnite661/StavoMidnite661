import React, { useState } from "react";
import { api, shortHash } from "../api";
import type { CompileResult } from "../types";
import { Chip, KV, OkBadge, Panel, useAsync } from "../ui";

export function CompilerTab() {
  const [result, setResult] = useState<CompileResult>();
  const [busy, setBusy] = useState<string>();
  const [det, setDet] = useState<any>();
  const [genFile, setGenFile] = useState("command-handlers.ts");
  const genSrc = useAsync(() => api.generated(genFile), [genFile, result?.buildIdentity]);

  const run = async (fault?: string) => {
    setBusy(fault ?? "compile");
    try {
      const r = await api.compile(fault);
      setResult(r.data);
    } finally {
      setBusy(undefined);
    }
  };

  const runDet = async () => {
    setBusy("determinism");
    try {
      const r = await api.compileDeterminism();
      setDet(r.data);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Compile Pipeline" right={<Chip tone="neon">fail-closed</Chip>}>
          <p className="text-[12px] text-slate-400 leading-relaxed">
            Corpus load → schema → semantic → cross-reference → state machines → capabilities → IR →
            registries → code generation → build identity → reproducibility. Any unresolved reference
            aborts the build; the live authority is never replaced by an incomplete one.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-neon" disabled={!!busy} onClick={() => run()}>
              {busy === "compile" ? "compiling…" : "Compile corpus"}
            </button>
            <button className="btn-ghost" disabled={!!busy} onClick={runDet}>
              {busy === "determinism" ? "checking…" : "Verify determinism"}
            </button>
          </div>
          <div className="mt-4 pt-3 border-t border-edge/50">
            <div className="h-title mb-2">Fault injection</div>
            <div className="flex flex-wrap gap-2">
              {(["unknown_event", "missing_initial", "unknown_capability"] as const).map((f) => (
                <button key={f} className="btn-danger px-2.5 py-1.5 text-[11.5px]" disabled={!!busy} onClick={() => run(f)}>
                  inject: {f}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] font-mono text-slate-600">mutates a copy of the corpus — live authority is never touched by a failed build</p>
          </div>
        </Panel>

        <Panel title="Determinism Check" className="lg:col-span-2" right={det && <OkBadge ok={det.identical && det.sameIdentity} okText="BYTE-IDENTICAL" badText="DIVERGED" />}>
          {det ? (
            <div>
              <KV k="Artifact trees identical" v={String(det.identical)} />
              <KV k="Build identity A = B" v={String(det.sameIdentity)} />
              <KV k="Identity" v={<span className="text-neon-soft">{shortHash(det.identityA ?? "", 16)}</span>} />
              <KV k="Duration" v={`${det.durationMs} ms`} />
              <div className="mt-3 grid md:grid-cols-2 gap-4">
                <div>
                  <div className="h-title mb-2">Registry artifacts</div>
                  <div className="space-y-1 max-h-56 overflow-auto">
                    {(det.artifacts ?? []).map((a: any) => (
                      <div key={a.name} className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="text-slate-300 flex-1 truncate">{a.name}</span>
                        <span className="text-slate-500">{a.bytes} B</span>
                        <span className="text-neon-soft">{shortHash(a.sha256, 8)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="h-title mb-2">Generated modules</div>
                  <div className="space-y-1 max-h-56 overflow-auto">
                    {(det.generated ?? []).map((a: any) => (
                      <div key={a.name} className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="text-slate-300 flex-1 truncate">{a.name}</span>
                        <span className="text-slate-500">{a.bytes} B</span>
                        <span className="text-neon-soft">{shortHash(a.sha256, 8)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-slate-500 font-mono py-4">run the check to compare two independent compilations byte-for-byte</div>
          )}
        </Panel>
      </div>

      {result && (
        <Panel
          title={`Compilation result — ${new Date().toLocaleTimeString()}`}
          right={
            <div className="flex items-center gap-2">
              <OkBadge ok={result.ok} okText="OK" badText="ABORTED" />
              {result.replacedAuthority === false && <Chip tone="bad">authority NOT replaced</Chip>}
              {result.replacedAuthority === true && <Chip tone="ok">authority replaced</Chip>}
              {result.counts && (
                <Chip tone="dim">
                  {Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}
                </Chip>
              )}
            </div>
          }
        >
          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <div className="h-title mb-2">Stage log</div>
              <div className="space-y-1 max-h-96 overflow-auto pr-2">
                {result.logs.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11.5px] font-mono">
                    <span className={`w-4 shrink-0 text-center ${l.level === "ok" ? "text-ok" : l.level === "error" ? "text-danger" : l.level === "warn" ? "text-amber" : "text-slate-500"}`}>
                      {l.level === "ok" ? "✓" : l.level === "error" ? "✗" : l.level === "warn" ? "⚠" : "·"}
                    </span>
                    <span className="text-slate-600 w-32 shrink-0">{l.stage}</span>
                    <span className="text-slate-300 flex-1 break-words">{l.message}</span>
                    {typeof l.ms === "number" && <span className="text-slate-600 shrink-0">{l.ms} ms</span>}
                  </div>
                ))}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-[11.5px] font-mono text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                      <span className="text-slate-500">[{e.stage}]</span> {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="h-title mb-2">Build identity</div>
              <div className="text-[12px] font-mono text-neon-soft break-all bg-abyss/70 border border-edge/60 rounded-lg p-3">
                {result.buildIdentity ?? "— (build aborted)"}
              </div>
              <div className="h-title mt-4 mb-2">Corpus hash</div>
              <div className="text-[12px] font-mono text-slate-400 break-all">{result.corpusHash ?? "—"}</div>
              <div className="h-title mt-4 mb-2">Generated module source</div>
              <div className="flex items-center gap-2 mb-2">
                {["helpers.ts", "transitions.ts", "command-handlers.ts", "projections.ts"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setGenFile(f)}
                    className={`px-2 py-1 rounded-md text-[11px] font-mono border ${genFile === f ? "border-neon/50 text-neon bg-neon/10" : "border-edge text-slate-400 hover:text-slate-200"}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <pre className="text-[10.5px] font-mono leading-relaxed text-slate-400 whitespace-pre overflow-auto max-h-80 bg-abyss/70 border border-edge/60 rounded-lg p-3">
                {genSrc.data ?? genSrc.error ?? "—"}
              </pre>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
