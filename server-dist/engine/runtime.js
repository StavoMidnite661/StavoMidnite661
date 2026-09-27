"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = exports.Runtime = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const corpus_1 = require("./corpus");
const compiler_1 = require("./compiler");
const eventstore_1 = require("./eventstore");
const state_1 = require("./state");
const ledger_1 = require("./ledger");
const authz_1 = require("./authz");
const projections_1 = require("./projections");
const kernel_1 = require("./kernel");
const web3_1 = require("./web3");
const sim_1 = require("./sim");
const DATA_DIR = path_1.default.join(__dirname, "..", "data");
function loadGeneratedModules(generatedDir) {
    for (const name of fs_1.default.readdirSync(generatedDir)) {
        const p = path_1.default.join(generatedDir, name);
        delete require.cache[require.resolve(p)];
    }
    const trans = require(path_1.default.join(generatedDir, "transitions.ts"));
    const handlers = require(path_1.default.join(generatedDir, "command-handlers.ts"));
    const proj = require(path_1.default.join(generatedDir, "projections.ts"));
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
class Runtime {
    registry;
    modules;
    events;
    state;
    projections;
    ledger;
    authz;
    web3;
    kernel;
    sims;
    lastCompile;
    recentReceipts = [];
    listeners = new Set();
    startedAt = "";
    constructor() {
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        this.boot();
    }
    broadcast(msg) {
        for (const l of this.listeners) {
            try {
                l(msg);
            }
            catch {
                /* listener errors must not break the kernel */
            }
        }
    }
    /** Full boot: compile corpus → write artifacts → load authority → reconstruct state from the event log. */
    boot() {
        const corpus = (0, corpus_1.loadCorpus)();
        const result = (0, compiler_1.compileCorpus)(corpus);
        if (!result.ok) {
            throw new Error(`protocol compilation failed (${result.errors.length} errors): ${result.errors[0]?.message}`);
        }
        this.lastCompile = result;
        this.registry = result.registry;
        const { generatedDir } = (0, compiler_1.writeBuildOutputs)(DATA_DIR, result);
        this.modules = loadGeneratedModules(generatedDir);
        // JsonRegistryLoader principle: the runtime parses the JSON artifacts,
        // not the YAML corpus.
        const artifactsDir = path_1.default.join(DATA_DIR, "artifacts");
        const parsed = (name) => JSON.parse(fs_1.default.readFileSync(path_1.default.join(artifactsDir, name), "utf8"));
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
        if (!ledgerConfig)
            throw new Error("protocol.ledger config missing from compiled authority");
        this.authz = new authz_1.Authz(path_1.default.join(DATA_DIR, "authz.json"), this.registry.identities);
        this.ledger = new ledger_1.Ledger(path_1.default.join(DATA_DIR, "ledger.json"), ledgerConfig, true);
        // Ledger-boundary bootstrap accounts, materialized from compiled authority
        for (const acct of ledgerConfig.bootstrapAccounts) {
            if (!this.ledger.account(acct.id)) {
                this.ledger.postCreateAccount(acct.id, acct.name, "ledger-boundary", acct.opening ?? 0);
            }
        }
        this.events = new eventstore_1.EventStore(path_1.default.join(DATA_DIR, "events.jsonl"), {
            protocol: this.registry.protocol.name,
            version: this.registry.protocol.version,
            buildIdentity: this.registry.buildIdentity,
        });
        this.state = new state_1.StateRegistry();
        this.projections = new projections_1.ProjectionEngine(this.modules, this.registry.projections);
        this.replayFromEventLog();
        this.kernel = new kernel_1.Kernel({
            registry: this.registry,
            modules: this.modules,
            events: this.events,
            state: this.state,
            projections: this.projections,
            ledger: this.ledger,
            authz: this.authz,
            broadcast: (m) => {
                if (m.kind === "receipt" && m.receipt) {
                    const rc = m.receipt;
                    this.recentReceipts.unshift({
                        id: rc.id,
                        command: rc.command,
                        actor: rc.actor,
                        ok: rc.ok,
                        code: rc.code,
                        ts: rc.ts,
                    });
                    if (this.recentReceipts.length > 30)
                        this.recentReceipts.pop();
                }
                this.broadcast(m);
            },
        });
        this.web3 = new web3_1.Web3(path_1.default.join(DATA_DIR, "web3-keys.json"), this.registry);
        this.sims = new sim_1.Simulations(this);
        this.startedAt = new Date().toISOString();
    }
    /**
     * Rebuild one instance's view from a single event. Creation is implied by
     * first appearance; InstanceState events re-apply recorded data mutations
     * verbatim (generic — no protocol content is interpreted here).
     */
    applyEventToState(s, ev) {
        for (const a of ev.affected ?? []) {
            let inst = s.get(a.id);
            if (!inst) {
                const machine = this.registry.machines[a.machine];
                if (!machine)
                    continue;
                s.create(a.machine, a.id, {});
                s.setInitial(a.id, machine);
                inst = s.get(a.id);
                if (!inst)
                    continue;
                inst.createdAt = ev.ts; // first reference = birth, from the log
            }
            if (ev.type === "InstanceState") {
                Object.assign(inst.data, ev.payload["changes"] ?? {});
                continue;
            }
            const matches = (this.modules.transitions[a.machine]?.[ev.type] ?? []).filter((t) => t.from.includes(inst.state));
            if (matches.length > 0)
                inst.state = matches[matches.length - 1].to;
        }
    }
    /**
     * Event-sourced truth: rebuild state + projections strictly from the
     * event log. Rebuilds IN PLACE — the Runtime's state/projection objects
     * are stable for the process lifetime (the kernel holds references to
     * them), so no caller can observe a stale generation.
     */
    replayFromEventLog() {
        this.state.clear();
        this.projections.reinit();
        for (const ev of this.events.all()) {
            this.applyEventToState(this.state, ev);
            this.projections.onEvent(ev);
        }
        return { replayed: this.events.length };
    }
    /** Full replay comparison: independent reconstruction vs live state. */
    replayVerify() {
        const live = this.state.snapshot();
        const fresh = new state_1.StateRegistry();
        for (const ev of this.events.all())
            this.applyEventToState(fresh, ev);
        const replayed = fresh.snapshot();
        return {
            ok: live === replayed,
            events: this.events.length,
            live: live.slice(0, 16) + "…",
            replayed: replayed.slice(0, 16) + "…",
        };
    }
    compile(fault) {
        const corpus = (0, corpus_1.loadCorpus)();
        const data = fault ? (0, corpus_1.injectFault)(corpus.data, fault) : corpus.data;
        const mutated = { ...corpus, data };
        const result = (0, compiler_1.compileCorpus)(mutated);
        // Only a clean, fault-free compilation may replace the live authority.
        if (result.ok && !fault) {
            this.lastCompile = result;
            const { generatedDir } = (0, compiler_1.writeBuildOutputs)(DATA_DIR, result);
            this.modules = loadGeneratedModules(generatedDir);
            this.registry = { ...result.registry, compiledAt: new Date().toISOString() };
        }
        return result;
    }
    reset() {
        for (const f of ["events.jsonl", "ledger.json", "authz.json"]) {
            const p = path_1.default.join(DATA_DIR, f);
            if (fs_1.default.existsSync(p))
                fs_1.default.unlinkSync(p);
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
    scenarioReports() {
        return this.sims.reports;
    }
}
exports.Runtime = Runtime;
exports.runtime = new Runtime();
