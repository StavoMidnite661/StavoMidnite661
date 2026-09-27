import fs from "fs";
import path from "path";
import { loadCorpus, injectFault } from "./corpus";
import { compileCorpus, writeBuildOutputs, type CompileOutput } from "./compiler";
import { EventStore } from "./eventstore";
import { StateRegistry } from "./state";
import { Ledger } from "./ledger";
import { Authz } from "./authz";
import { ProjectionEngine } from "./projections";
import { Kernel } from "./kernel";
import { Web3 } from "./web3";
import { Simulations } from "./sim";
import type { GeneratedModules, Registry, ScenarioReport } from "./types";

const DATA_DIR = path.join(__dirname, "..", "data");

function loadGeneratedModules(generatedDir: string): GeneratedModules {
  for (const name of fs.readdirSync(generatedDir)) {
    const p = path.join(generatedDir, name);
    delete require.cache[require.resolve(p)];
  }
  const trans = require(path.join(generatedDir, "transitions.ts"));
  const handlers = require(path.join(generatedDir, "command-handlers.ts"));
  const proj = require(path.join(generatedDir, "projections.ts"));
  return {
    transitions: trans.transitions,
    commandHandlers: handlers.commandHandlers,
    projectionReduces: proj.projectionReduces,
    projectionInitials: proj.projectionInitials,
    projectionKinds: proj.projectionKinds,
  };
}

/**
 * The SOVR runtime: loads the compiled authority (JSON registries +
 * generated TS modules) and owns the live event-sourced state.
 */
export class Runtime {
  registry!: Registry;
  modules!: GeneratedModules;
  events!: EventStore;
  state!: StateRegistry;
  projections!: ProjectionEngine;
  ledger!: Ledger;
  authz!: Authz;
  web3!: Web3;
  kernel!: Kernel;
  sims!: Simulations;
  lastCompile!: CompileOutput;
  recentReceipts: { id: string; command: string; actor: string; ok: boolean; code: string; ts: string }[] = [];
  listeners = new Set<(msg: { kind: string; [k: string]: unknown }) => void>();
  startedAt = "";

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.boot();
  }

  private broadcast(msg: { kind: string; [k: string]: unknown }): void {
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch {
        /* listener errors must not break the kernel */
      }
    }
  }

  /** Full boot: compile corpus → write artifacts → load authority → reconstruct state from the event log. */
  boot(): void {
    const corpus = loadCorpus();
    const result = compileCorpus(corpus);
    if (!result.ok) {
      throw new Error(`protocol compilation failed (${result.errors.length} errors): ${result.errors[0]?.message}`);
    }
    this.lastCompile = result;
    this.registry = result.registry;
    const { generatedDir } = writeBuildOutputs(DATA_DIR, result);
    this.modules = loadGeneratedModules(generatedDir);

    // JsonRegistryLoader principle: the runtime parses the JSON artifacts,
    // not the YAML corpus.
    const artifactsDir = path.join(DATA_DIR, "artifacts");
    const parsed = (name: string) => JSON.parse(fs.readFileSync(path.join(artifactsDir, name), "utf8"));
    this.registry = {
      ...this.registry,
      identities: parsed("identities.json"),
      commands: parsed("commands.json"),
      events: parsed("events.json"),
      machines: parsed("state-machines.json"),
      capabilities: parsed("capabilities.json"),
      gates: parsed("gates.json"),
      projections: parsed("projections.json"),
      scenarios: parsed("scenarios.json"),
    };

    // The kernel's fail-closed evidence language requires these system events.
    for (const required of ["CommandRejected", "AuthorizationDenied"]) {
      if (!this.registry.events[required]) {
        throw new Error(`kernel evidence language unsatisfied: event "${required}" missing from compiled authority`);
      }
    }

    const ledgerConfig = this.registry.protocol.ledger;
    if (!ledgerConfig) throw new Error("protocol.ledger config missing from compiled authority");

    this.authz = new Authz(path.join(DATA_DIR, "authz.json"), this.registry.identities);
    this.ledger = new Ledger(path.join(DATA_DIR, "ledger.json"), ledgerConfig, true);
    // Ledger-boundary bootstrap accounts, materialized from compiled authority
    for (const acct of ledgerConfig.bootstrapAccounts) {
      if (!this.ledger.account(acct.id)) {
        this.ledger.postCreateAccount(acct.id, acct.name, "ledger-boundary", acct.opening ?? 0);
      }
    }

    this.events = new EventStore(path.join(DATA_DIR, "events.jsonl"), {
      protocol: this.registry.protocol.name,
      version: this.registry.protocol.version,
      buildIdentity: this.registry.buildIdentity,
    });
    this.state = new StateRegistry();
    this.projections = new ProjectionEngine(this.modules, this.registry.projections);
    this.replayFromEventLog();

    this.kernel = new Kernel({
      registry: this.registry,
      modules: this.modules,
      events: this.events,
      state: this.state,
      projections: this.projections,
      ledger: this.ledger,
      authz: this.authz,
      broadcast: (m) => {
        if (m.kind === "receipt" && m.receipt) {
          const rc = m.receipt as any;
          this.recentReceipts.unshift({
            id: rc.id,
            command: rc.command,
            actor: rc.actor,
            ok: rc.ok,
            code: rc.code,
            ts: rc.ts,
          });
          if (this.recentReceipts.length > 30) this.recentReceipts.pop();
        }
        this.broadcast(m);
      },
    });
    this.web3 = new Web3(path.join(DATA_DIR, "web3-keys.json"), this.registry);
    this.sims = new Simulations(this);
    this.startedAt = new Date().toISOString();
  }

  /**
   * Rebuild one instance's view from a single event. Creation is implied by
   * first appearance; InstanceState events re-apply recorded data mutations
   * verbatim (generic — no protocol content is interpreted here).
   */
  private applyEventToState(s: StateRegistry, ev: { ts: string; type: string; affected?: { id: string; machine: string }[]; payload: Record<string, unknown> }): void {
    for (const a of ev.affected ?? []) {
      let inst = s.get(a.id);
      if (!inst) {
        const machine = this.registry.machines[a.machine];
        if (!machine) continue;
        s.create(a.machine, a.id, {});
        s.setInitial(a.id, machine);
        inst = s.get(a.id);
        if (!inst) continue;
        inst.createdAt = ev.ts; // first reference = birth, from the log
      }
      if (ev.type === "InstanceState") {
        Object.assign(inst.data, (ev.payload["changes"] as Record<string, unknown>) ?? {});
        continue;
      }
      const matches = (this.modules.transitions[a.machine]?.[ev.type] ?? []).filter((t) => t.from.includes(inst.state));
      if (matches.length > 0) inst.state = matches[matches.length - 1].to;
    }
  }

  /**
   * Event-sourced truth: rebuild state + projections strictly from the
   * event log. Rebuilds IN PLACE — the Runtime's state/projection objects
   * are stable for the process lifetime (the kernel holds references to
   * them), so no caller can observe a stale generation.
   */
  replayFromEventLog(): { replayed: number } {
    this.state.clear();
    this.projections.reinit();
    for (const ev of this.events.all()) {
      this.applyEventToState(this.state, ev);
      this.projections.onEvent(ev);
    }
    return { replayed: this.events.length };
  }

  /** Full replay comparison: independent reconstruction vs live state. */
  replayVerify(): { ok: boolean; events: number; live: string; replayed: string } {
    const live = this.state.snapshot();
    const fresh = new StateRegistry();
    for (const ev of this.events.all()) this.applyEventToState(fresh, ev);
    const replayed = fresh.snapshot();
    return {
      ok: live === replayed,
      events: this.events.length,
      live: live.slice(0, 16) + "…",
      replayed: replayed.slice(0, 16) + "…",
    };
  }

  compile(fault?: "unknown_event" | "missing_initial" | "unknown_capability"): CompileOutput {
    const corpus = loadCorpus();
    const data = fault ? injectFault(corpus.data, fault) : corpus.data;
    const mutated = { ...corpus, data };
    const result = compileCorpus(mutated);
    // Only a clean, fault-free compilation may replace the live authority.
    if (result.ok && !fault) {
      this.lastCompile = result;
      const { generatedDir } = writeBuildOutputs(DATA_DIR, result);
      this.modules = loadGeneratedModules(generatedDir);
      this.registry = { ...result.registry, compiledAt: new Date().toISOString() };
    }
    return result;
  }

  reset(): void {
    for (const f of ["events.jsonl", "ledger.json", "authz.json"]) {
      const p = path.join(DATA_DIR, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    this.boot();
    this.broadcast({ kind: "reset", at: new Date().toISOString() });
  }

  overview() {
    const ledgerVerify = this.ledger.verify();
    const chain = this.events.verify();
    return {
      startedAt: this.startedAt,
      build: {
        identity: this.registry.buildIdentity,
        corpusHash: this.registry.corpusHash,
        protocol: this.registry.protocol.name,
        version: this.registry.protocol.version,
        unit: this.registry.protocol.unit,
        compiledAt: this.registry.compiledAt,
        artifacts: this.lastCompile.artifactInfo?.length ?? 0,
        generated: this.lastCompile.generatedInfo?.length ?? 0,
      },
      counts: {
        events: this.events.length,
        entities: this.state.all().length,
        transfers: this.ledger.transfers.length,
        ledgerAccounts: this.ledger.accounts.size,
        grants: this.authz.grants.length,
        denials: this.authz.denials.length,
        keys: this.web3.keys.length,
      },
      integrity: {
        chain: { ok: chain.ok, checked: chain.checked, brokenAt: chain.brokenAt },
        ledger: {
          doubleEntry: ledgerVerify.doubleEntry,
          balancesMatch: ledgerVerify.balancesMatch,
          supplyInvariant: ledgerVerify.supplyInvariant,
          totalBalance: ledgerVerify.totalBalance,
          genesisSupply: this.ledger.genesisSupply,
        },
      },
      supply: { reserve: this.ledger.balance(this.ledger.reserve), total: ledgerVerify.totalBalance, genesis: this.ledger.genesisSupply },
      recent: {
        receipts: this.recentReceipts.slice(0, 15),
        events: this.events.list(15),
      },
      countsByMachine: this.state.countsByMachine(),
    };
  }

  scenarioReports(): ScenarioReport[] {
    return this.sims.reports;
  }
}

export const runtime = new Runtime();
