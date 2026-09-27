import React, { useState } from "react";
import { api, shortHash } from "../api";
import { Chip, Panel, Spinner, useAsync } from "../ui";

const FILES = [
  ["domains.yaml", "protocol meta · ledger genesis · EIP-712 types · domains"],
  ["identities.yaml", "identity roster · genesis grants · constitutional authority"],
  ["capabilities.yaml", "capability definitions"],
  ["state-machines.yaml", "machines · states · transitions"],
  ["events.yaml", "event catalog · payload schemas"],
  ["commands.yaml", "command authority · effects · gates · emits"],
  ["governance.yaml", "constitutional gates · limits"],
  ["projections.yaml", "projection definitions"],
  ["scenarios.yaml", "end-to-end verification scenarios"],
];

export function ProtocolTab() {
  const [file, setFile] = useState("commands.yaml");
  const proto = useAsync(() => api.protocol().then((r) => r.data), []);
  const yaml = useAsync(() => api.protocolYaml(file), [file]);

  if (proto.loading && !proto.data) return <Spinner label="loading compiled protocol…" />;

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-5 items-start">
      <div className="space-y-5">
        <Panel title="Compiled Protocol" right={proto.data && <Chip tone="neon">{proto.data.protocol?.name}</Chip>}>
          {proto.data && (
            <div className="space-y-2">
              {Object.entries(proto.data.counts ?? {}).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[12px] font-mono">
                  <span className="text-slate-400">{k}</span>
                  <span className="text-slate-100">{v as number}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-edge/50 space-y-1.5">
                <div className="text-[11px] font-mono text-slate-500">corpus hash</div>
                <div className="text-[11px] font-mono text-neon-soft">{shortHash(proto.data.corpusHash ?? "", 14)}</div>
                <div className="text-[11px] font-mono text-slate-500 pt-1">build identity</div>
                <div className="text-[11px] font-mono text-neon-soft">{shortHash(proto.data.buildIdentity ?? "", 14)}</div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Corpus Files" right={<Chip tone="ok">.yaml only</Chip>}>
          <div className="space-y-1">
            {FILES.map(([f, desc]) => (
              <button
                key={f}
                onClick={() => setFile(f)}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                  file === f ? "border-neon/50 bg-neon/10" : "border-transparent hover:bg-panel2"
                }`}
              >
                <div className={`text-[12px] font-mono font-semibold ${file === f ? "text-neon" : "text-slate-200"}`}>{f}</div>
                <div className="text-[10.5px] text-slate-500 leading-snug mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title={`Corpus source — ${file}`}
        right={
          <div className="flex items-center gap-2">
            <Chip tone="dim">machine-readable protocol source</Chip>
            <Chip tone="ok">compiled at boot</Chip>
          </div>
        }
      >
        {yaml.loading ? (
          <Spinner label="loading corpus…" />
        ) : yaml.error ? (
          <div className="text-danger font-mono text-sm">{yaml.error}</div>
        ) : (
          <pre className="text-[11.5px] font-mono leading-relaxed text-slate-300 whitespace-pre overflow-auto max-h-[calc(100vh-260px)] bg-abyss/70 border border-edge/60 rounded-lg p-4">
            {yaml.data}
          </pre>
        )}
      </Panel>
    </div>
  );
}
