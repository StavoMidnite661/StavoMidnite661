"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.artifactInfo = artifactInfo;
exports.computeBuildIdentity = computeBuildIdentity;
exports.compileCorpus = compileCorpus;
exports.writeBuildOutputs = writeBuildOutputs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hash_1 = require("../crypto/hash");
const corpus_1 = require("./corpus");
const codegen_1 = require("./codegen");
function err(ctx, stage, message) {
    ctx.errors.push({ stage, message });
    ctx.logs.push({ stage, level: "error", message });
}
function info(ctx, stage, message, ms) {
    ctx.logs.push({ stage, level: "info", message, ms });
}
function ok(ctx, stage, message, ms) {
    ctx.logs.push({ stage, level: "ok", message, ms });
}
function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
}
// ---------------------------------------------------------------- schema
function stageSchema(ctx) {
    const t0 = Date.now();
    const d = ctx.data;
    const proto = d.domains?.protocol;
    if (!proto || !isNonEmptyString(proto.name) || !isNonEmptyString(proto.version)) {
        err(ctx, "schema-validation", "domains.yaml: protocol.name and protocol.version are required");
    }
    if (!proto?.unit || typeof proto.unit.base !== "number") {
        err(ctx, "schema-validation", "domains.yaml: protocol.unit.base must be a number");
    }
    if (proto?.web3) {
        if (!proto.web3.primaryType)
            err(ctx, "schema-validation", "domains.yaml: protocol.web3.primaryType required");
        if (!proto.web3.types || typeof proto.web3.types !== "object")
            err(ctx, "schema-validation", "domains.yaml: protocol.web3.types required");
    }
    if (proto?.ledger) {
        if (typeof proto.ledger.genesisSupply !== "number" || proto.ledger.genesisSupply <= 0)
            err(ctx, "schema-validation", "domains.yaml: protocol.ledger.genesisSupply must be a positive number");
        if (!isNonEmptyString(proto.ledger.reserve))
            err(ctx, "schema-validation", "domains.yaml: protocol.ledger.reserve required");
        if (!Array.isArray(proto.ledger.bootstrapAccounts))
            err(ctx, "schema-validation", "domains.yaml: protocol.ledger.bootstrapAccounts[] required");
        else {
            const seen = new Set();
            for (const a of proto.ledger.bootstrapAccounts) {
                if (!isNonEmptyString(a?.id))
                    err(ctx, "schema-validation", "domains.yaml: bootstrapAccounts[] entry missing id");
                else {
                    if (seen.has(a.id))
                        err(ctx, "schema-validation", `domains.yaml: duplicate bootstrap account ${a.id}`);
                    seen.add(a.id);
                    if (a.id === proto.ledger.reserve)
                        err(ctx, "schema-validation", `domains.yaml: bootstrap account "${a.id}" collides with the reserve id`);
                }
                if (!isNonEmptyString(a?.name))
                    err(ctx, "schema-validation", "domains.yaml: bootstrapAccounts[] entry missing name");
                if (a?.opening !== undefined && (typeof a.opening !== "number" || a.opening < 0 || !Number.isInteger(a.opening)))
                    err(ctx, "schema-validation", `domains.yaml: bootstrap account "${a?.id}" opening must be a non-negative integer`);
            }
        }
    }
    const domains = d.domains?.domains;
    if (!Array.isArray(domains) || domains.length === 0) {
        err(ctx, "schema-validation", "domains.yaml: domains[] is required");
        return;
    }
    const domainIds = new Set();
    for (const dom of domains) {
        if (!isNonEmptyString(dom?.id)) {
            err(ctx, "schema-validation", "domains.yaml: domain entry missing id");
            continue;
        }
        if (domainIds.has(dom.id))
            err(ctx, "schema-validation", `domains.yaml: duplicate domain ${dom.id}`);
        domainIds.add(dom.id);
        if (!isNonEmptyString(dom.name))
            err(ctx, "schema-validation", `domains.yaml: domain ${dom.id} missing name`);
    }
    for (const cap of d.capabilities?.capabilities ?? []) {
        if (!isNonEmptyString(cap?.id)) {
            err(ctx, "schema-validation", "capabilities.yaml: entry missing id");
            continue;
        }
        if (!domainIds.has(cap.domain))
            err(ctx, "schema-validation", `capability ${cap.id}: unknown domain "${cap.domain}"`);
        if (!isNonEmptyString(cap.name))
            err(ctx, "schema-validation", `capability ${cap.id}: missing name`);
    }
    for (const m of d["state-machines"]?.machines ?? []) {
        if (!isNonEmptyString(m?.id)) {
            err(ctx, "schema-validation", "state-machines.yaml: machine missing id");
            continue;
        }
        if (!Array.isArray(m.states) || m.states.length === 0)
            err(ctx, "schema-validation", `machine ${m.id}: states[] required`);
        if (!isNonEmptyString(m.initial))
            err(ctx, "schema-validation", `machine ${m.id}: initial state required`);
        if (!Array.isArray(m.transitions))
            err(ctx, "schema-validation", `machine ${m.id}: transitions[] required`);
    }
    for (const e of d.events?.events ?? []) {
        if (!isNonEmptyString(e?.id)) {
            err(ctx, "schema-validation", "events.yaml: event missing id");
            continue;
        }
        if (!domainIds.has(e.domain))
            err(ctx, "schema-validation", `event ${e.id}: unknown domain "${e.domain}"`);
        if (!e.payload || typeof e.payload !== "object")
            err(ctx, "schema-validation", `event ${e.id}: payload schema required`);
    }
    const capIds = new Set((d.capabilities?.capabilities ?? []).map((c) => c?.id).filter(Boolean));
    const identityIds = new Set();
    for (const i of d.identities?.identities ?? []) {
        if (!isNonEmptyString(i?.id)) {
            err(ctx, "schema-validation", "identities.yaml: identity missing id");
            continue;
        }
        if (identityIds.has(i.id))
            err(ctx, "schema-validation", `identities.yaml: duplicate identity ${i.id}`);
        identityIds.add(i.id);
        if (!isNonEmptyString(i.name))
            err(ctx, "schema-validation", `identity ${i.id}: missing name`);
        if (!isNonEmptyString(i.kind))
            err(ctx, "schema-validation", `identity ${i.id}: missing kind`);
        if (!Array.isArray(i.capabilities))
            err(ctx, "schema-validation", `identity ${i.id}: capabilities[] required`);
        for (const cap of i.capabilities ?? []) {
            if (!capIds.has(cap))
                err(ctx, "schema-validation", `identity ${i.id}: unknown capability "${cap}"`);
        }
    }
    for (const c of d.commands?.commands ?? []) {
        if (!isNonEmptyString(c?.id)) {
            err(ctx, "schema-validation", "commands.yaml: command missing id");
            continue;
        }
        if (!domainIds.has(c.domain))
            err(ctx, "schema-validation", `command ${c.id}: unknown domain "${c.domain}"`);
        if (!Array.isArray(c.capabilities) || c.capabilities.length === 0)
            err(ctx, "schema-validation", `command ${c.id}: capabilities[] required`);
        if (!c.payload || typeof c.payload !== "object")
            err(ctx, "schema-validation", `command ${c.id}: payload spec required`);
        if (!Array.isArray(c.emits) || c.emits.length === 0)
            err(ctx, "schema-validation", `command ${c.id}: emits[] required`);
        for (const cap of c.capabilities ?? []) {
            if (!capIds.has(cap))
                err(ctx, "schema-validation", `command ${c.id}: unknown capability "${cap}"`);
        }
        for (const [field, type] of Object.entries(c.payload ?? {})) {
            if (!["string", "int", "amount", "bool"].includes(type))
                err(ctx, "schema-validation", `command ${c.id}: payload field "${field}" has invalid type "${type}"`);
        }
        if (c.sourceInstance && !isNonEmptyString(c.sourceInstance.alias))
            err(ctx, "schema-validation", `command ${c.id}: sourceInstance.alias required`);
    }
    const gateIds = new Set();
    const RULES = ["max_amount", "no_self_settlement", "credit_headroom", "liquidation_utilization", "meta_grant_protection", "repay_within_outstanding"];
    for (const g of d.governance?.gates ?? []) {
        if (!isNonEmptyString(g?.id)) {
            err(ctx, "schema-validation", "governance.yaml: gate missing id");
            continue;
        }
        if (gateIds.has(g.id))
            err(ctx, "schema-validation", `governance.yaml: duplicate gate ${g.id}`);
        gateIds.add(g.id);
        if (!RULES.includes(g.rule))
            err(ctx, "schema-validation", `gate ${g.id}: unknown rule "${g.rule}"`);
    }
    for (const c of d.commands?.commands ?? []) {
        for (const g of c.gates ?? []) {
            if (!gateIds.has(g?.id))
                err(ctx, "schema-validation", `command ${c.id}: unknown gate "${g?.id}"`);
        }
    }
    for (const p of d.projections?.projections ?? []) {
        if (!isNonEmptyString(p?.id))
            err(ctx, "schema-validation", "projections.yaml: projection missing id");
        if (!["aggregate", "census", "timeline"].includes(p?.kind))
            err(ctx, "schema-validation", `projection ${p?.id}: kind must be aggregate | census | timeline`);
        if (p?.kind === "aggregate" && !Array.isArray(p.updates))
            err(ctx, "schema-validation", `projection ${p?.id}: aggregate projections require updates[]`);
    }
    for (const s of d.scenarios?.scenarios ?? []) {
        if (!isNonEmptyString(s?.id)) {
            err(ctx, "schema-validation", "scenarios.yaml: scenario missing id");
            continue;
        }
        if (!Array.isArray(s.steps) || s.steps.length === 0)
            err(ctx, "schema-validation", `scenario ${s.id}: steps[] required`);
        for (const st of s.steps ?? []) {
            if (st.command && st.actor === undefined)
                err(ctx, "schema-validation", `scenario ${s.id}: step ${st.command} missing actor`);
            if (!st.expect)
                err(ctx, "schema-validation", `scenario ${s.id}: step missing expect`);
        }
    }
    ok(ctx, "schema-validation", `schema validation complete (${ctx.errors.length} error(s))`, Date.now() - t0);
}
// ---------------------------------------------------------------- semantic
function stageSemantic(ctx) {
    const t0 = Date.now();
    const d = ctx.data;
    for (const m of d["state-machines"]?.machines ?? []) {
        const states = new Set(m.states ?? []);
        if (m.initial && !states.has(m.initial)) {
            err(ctx, "semantic-validation", `machine ${m.id}: initial state "${m.initial}" is not defined in states`);
        }
        for (const t of m.transitions ?? []) {
            if (!isNonEmptyString(t.event))
                err(ctx, "semantic-validation", `machine ${m.id}: transition missing event`);
            if (!isNonEmptyString(t.to) || !states.has(t.to))
                err(ctx, "semantic-validation", `machine ${m.id}: transition to-state "${t.to}" undefined`);
            for (const f of t.from ?? []) {
                if (!states.has(f))
                    err(ctx, "semantic-validation", `machine ${m.id}: transition from-state "${f}" undefined`);
            }
        }
        for (const f of m.terminal ?? []) {
            if (!states.has(f))
                err(ctx, "semantic-validation", `machine ${m.id}: terminal state "${f}" undefined`);
        }
    }
    for (const c of d.commands?.commands ?? []) {
        for (const pre of c.preconditions ?? []) {
            if (!isNonEmptyString(pre.machine))
                err(ctx, "semantic-validation", `command ${c.id}: precondition missing machine`);
            if (!isNonEmptyString(pre.idFrom))
                err(ctx, "semantic-validation", `command ${c.id}: precondition missing idFrom`);
            if (!Array.isArray(pre.inStates) || pre.inStates.length === 0)
                err(ctx, "semantic-validation", `command ${c.id}: precondition inStates required`);
        }
        if (c.creates && !isNonEmptyString(c.creates.machine))
            err(ctx, "semantic-validation", `command ${c.id}: creates.machine required`);
        for (const de of c.dataEffects ?? []) {
            if (!["set", "add", "sub", "push"].includes(de.op))
                err(ctx, "semantic-validation", `command ${c.id}: dataEffect op "${de.op}" invalid`);
        }
        if (c.ledger && !["transfer", "create_account"].includes(c.ledger.kind))
            err(ctx, "semantic-validation", `command ${c.id}: ledger effect kind invalid`);
        if (c.verify && c.verify.kind !== "eip712_attestation")
            err(ctx, "semantic-validation", `command ${c.id}: verify kind unsupported`);
    }
    ok(ctx, "semantic-validation", "semantic validation complete", Date.now() - t0);
}
// ---------------------------------------------------------------- cross-reference
function stageCrossRef(ctx) {
    const t0 = Date.now();
    const d = ctx.data;
    const eventIds = new Set((d.events?.events ?? []).map((e) => e?.id).filter(Boolean));
    const machineIds = new Set((d["state-machines"]?.machines ?? []).map((m) => m?.id).filter(Boolean));
    const commandIds = new Set((d.commands?.commands ?? []).map((c) => c?.id).filter(Boolean));
    const gateIds = new Set((d.governance?.gates ?? []).map((g) => g?.id).filter(Boolean));
    const machineStates = {};
    for (const m of d["state-machines"]?.machines ?? []) {
        machineStates[m.id] = new Set(m.states ?? []);
    }
    for (const m of d["state-machines"]?.machines ?? []) {
        for (const t of m.transitions ?? []) {
            if (t.event && !eventIds.has(t.event))
                err(ctx, "cross-reference", `machine ${m.id}: transition references undefined event "${t.event}"`);
        }
    }
    for (const c of d.commands?.commands ?? []) {
        for (const emit of c.emits ?? []) {
            if (!eventIds.has(emit?.event))
                err(ctx, "cross-reference", `command ${c.id}: emits undefined event "${emit?.event}"`);
        }
        for (const pre of c.preconditions ?? []) {
            if (!machineIds.has(pre.machine))
                err(ctx, "cross-reference", `command ${c.id}: precondition references undefined machine "${pre.machine}"`);
            else
                for (const s of pre.inStates ?? [])
                    if (!machineStates[pre.machine]?.has(s))
                        err(ctx, "cross-reference", `command ${c.id}: precondition state "${s}" not in machine ${pre.machine}`);
        }
        if (c.creates && !machineIds.has(c.creates.machine))
            err(ctx, "cross-reference", `command ${c.id}: creates undefined machine "${c.creates.machine}"`);
        if (c.sourceInstance && !machineIds.has(c.sourceInstance.machine))
            err(ctx, "cross-reference", `command ${c.id}: sourceInstance references undefined machine`);
        for (const de of c.dataEffects ?? []) {
            if (!machineIds.has(de.machine))
                err(ctx, "cross-reference", `command ${c.id}: dataEffect references undefined machine "${de.machine}"`);
        }
        for (const g of c.gates ?? []) {
            if (!gateIds.has(g.id))
                err(ctx, "cross-reference", `command ${c.id}: references undefined gate "${g.id}"`);
        }
    }
    for (const e of d.events?.events ?? []) {
        for (const [field, type] of Object.entries(e.payload ?? {})) {
            if (!["string", "int", "amount", "bool"].includes(type))
                err(ctx, "cross-reference", `event ${e.id}: payload field "${field}" has invalid type "${type}"`);
        }
    }
    for (const p of d.projections?.projections ?? []) {
        for (const u of p.updates ?? []) {
            if (!eventIds.has(u.event))
                err(ctx, "cross-reference", `projection ${p.id}: update references undefined event "${u.event}"`);
            if (!["inc", "sum", "sub", "set", "push"].includes(u.op))
                err(ctx, "cross-reference", `projection ${p.id}: update op "${u.op}" invalid`);
            if (u.op !== "inc" && !u.from)
                err(ctx, "cross-reference", `projection ${p.id}: op "${u.op}" requires a payload source field`);
        }
    }
    const actorIds = new Set((d.identities?.identities ?? []).map((i) => i?.id).filter(Boolean));
    for (const s of d.scenarios?.scenarios ?? []) {
        s.steps?.forEach((st, i) => {
            if (st.command && !commandIds.has(st.command))
                err(ctx, "cross-reference", `scenario ${s.id} step ${i + 1}: unknown command "${st.command}"`);
            if (st.actor && !actorIds.has(st.actor))
                err(ctx, "cross-reference", `scenario ${s.id} step ${i + 1}: unknown actor "${st.actor}" (not in identities.yaml)`);
            if (!st.command && !st.verify)
                err(ctx, "cross-reference", `scenario ${s.id} step ${i + 1}: step has neither command nor verify`);
            if (!["ok", "denied", "rejected"].includes(st.expect))
                err(ctx, "cross-reference", `scenario ${s.id} step ${i + 1}: invalid expect "${st.expect}"`);
        });
    }
    ok(ctx, "cross-reference", "cross-reference validation complete", Date.now() - t0);
}
// ---------------------------------------------------------------- state machines + capabilities
function stageMachines(ctx) {
    const t0 = Date.now();
    const machines = (ctx.data["state-machines"]?.machines ?? []);
    let transitions = 0;
    for (const m of machines) {
        transitions += (m.transitions ?? []).length;
        const reachable = new Set([m.initial]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const t of m.transitions ?? []) {
                const froms = t.from ?? [m.initial];
                for (const f of froms) {
                    if (reachable.has(f) && !reachable.has(t.to)) {
                        reachable.add(t.to);
                        changed = true;
                    }
                }
            }
        }
        for (const s of m.states) {
            if (!reachable.has(s) && !m.terminal?.includes(s)) {
                ctx.logs.push({
                    stage: "state-machines",
                    level: "warn",
                    message: `machine ${m.id}: state "${s}" unreachable from initial (advisory)`,
                });
            }
        }
    }
    ok(ctx, "state-machines", `state-machine validation passed (${machines.length} machines, ${transitions} transitions)`, Date.now() - t0);
}
function stageCapabilities(ctx) {
    const t0 = Date.now();
    const caps = (ctx.data.capabilities?.capabilities ?? []);
    const capIds = new Set(caps.map((c) => c.id));
    for (const c of caps) {
        if (c.meta && c.id !== "authz:grant") {
            ctx.logs.push({ stage: "capabilities", level: "warn", message: `capability ${c.id}: meta capability defined outside authz:grant (advisory)` });
        }
    }
    const commands = (ctx.data.commands?.commands ?? []);
    const used = new Set();
    for (const c of commands)
        for (const cap of c.capabilities ?? [])
            used.add(cap);
    let unused = 0;
    for (const id of capIds)
        if (!used.has(id))
            unused++;
    if (unused > 0) {
        ctx.logs.push({ stage: "capabilities", level: "info", message: `${unused} capability(ies) not referenced by any command (auditable surface)` });
    }
    ok(ctx, "capabilities", `capability validation passed (${caps.length} capabilities)`, Date.now() - t0);
}
// ---------------------------------------------------------------- IR + artifacts + codegen
function toRecord(list) {
    const out = {};
    for (const item of list)
        out[item.id] = item;
    return out;
}
/** Normalize a command into complete canonical form (IR is total, not partial). */
function normalizeCommand(c) {
    return {
        ...c,
        capabilities: c.capabilities ?? [],
        preconditions: c.preconditions ?? [],
        dataEffects: c.dataEffects ?? [],
        gates: c.gates ?? [],
        emits: c.emits ?? [],
    };
}
function buildRegistry(data, corpusHashHex, buildIdentity, compiledAt) {
    const d = data;
    const rawCommands = toRecord(d.commands.commands);
    const commands = {};
    for (const [id, c] of Object.entries(rawCommands))
        commands[id] = normalizeCommand(c);
    return {
        protocol: d.domains.protocol,
        domains: d.domains.domains,
        identities: toRecord(d.identities.identities),
        commands,
        events: toRecord(d.events.events),
        machines: toRecord(d["state-machines"].machines),
        capabilities: toRecord(d.capabilities.capabilities),
        gates: toRecord(d.governance.gates),
        projections: d.projections.projections,
        scenarios: d.scenarios.scenarios,
        corpusHash: corpusHashHex,
        buildIdentity,
        compiledAt,
    };
}
function buildArtifacts(data, reg) {
    const d = data;
    return {
        "protocol.json": (0, hash_1.stableStringify)({ protocol: d.domains.protocol, domains: d.domains.domains }),
        "identities.json": (0, hash_1.stableStringify)(reg.identities),
        "commands.json": (0, hash_1.stableStringify)(reg.commands),
        "events.json": (0, hash_1.stableStringify)(reg.events),
        "state-machines.json": (0, hash_1.stableStringify)(reg.machines),
        "capabilities.json": (0, hash_1.stableStringify)(reg.capabilities),
        "gates.json": (0, hash_1.stableStringify)(reg.gates),
        "projections.json": (0, hash_1.stableStringify)(reg.projections),
        "scenarios.json": (0, hash_1.stableStringify)(reg.scenarios),
    };
}
function artifactInfo(files) {
    return Object.keys(files)
        .sort()
        .map((name) => ({
        name,
        bytes: Buffer.byteLength(files[name], "utf8"),
        sha256: (0, hash_1.sha256Hex)(files[name]),
    }));
}
/** Build identity over every generated artifact (registries + TS modules). */
function computeBuildIdentity(all) {
    let input = "";
    for (const name of Object.keys(all).sort()) {
        input += name + "\n" + all[name] + "\n";
    }
    return "sha256:" + (0, hash_1.sha256Hex)(input);
}
/**
 * The full compilation pipeline. Fail-closed: any validation error aborts
 * before materialization; the live registry is never replaced by an
 * incomplete build.
 */
function compileCorpus(corpus) {
    const t0 = Date.now();
    const ctx = { data: corpus.data, files: corpus.files, logs: [], errors: [] };
    const c0 = Date.now();
    const ch = (0, corpus_1.corpusHash)(corpus.files);
    info(ctx, "corpus-load", `loaded ${Object.keys(corpus.files).length} corpus files, ${Object.values(corpus.files).reduce((a, b) => a + b.length, 0)} bytes`);
    ok(ctx, "corpus-load", `corpus hash ${ch.slice(0, 18)}…`, Date.now() - c0);
    stageSchema(ctx);
    stageSemantic(ctx);
    stageCrossRef(ctx);
    stageMachines(ctx);
    stageCapabilities(ctx);
    if (ctx.errors.length > 0) {
        err(ctx, "build-identity", `compilation aborted fail-closed: ${ctx.errors.length} error(s); no authority materialized`);
        return {
            ok: false,
            logs: ctx.logs,
            errors: ctx.errors,
            durationMs: Date.now() - t0,
            registry: null,
        };
    }
    // IR materialization
    const r0 = Date.now();
    const reg = buildRegistry(corpus.data, ch, "pending", new Date().toISOString());
    ok(ctx, "ir-materialization", `canonical IR materialized: ${Object.keys(reg.commands).length} commands, ${Object.keys(reg.events).length} events, ${Object.keys(reg.machines).length} machines, ${Object.keys(reg.capabilities).length} capabilities, ${Object.keys(reg.identities).length} identities`, Date.now() - r0);
    // registry generation (JSON artifacts)
    const g0 = Date.now();
    const artifacts = buildArtifacts(corpus.data, reg);
    ok(ctx, "registry-generation", `${Object.keys(artifacts).length} registry artifacts generated (deterministic serialization)`, Date.now() - g0);
    // TypeScript code generation (compiler byproducts). Code generation
    // re-resolves every reference; anything unresolvable aborts the build.
    const code0 = Date.now();
    let generated;
    try {
        generated = (0, codegen_1.generateModules)(reg);
    }
    catch (e) {
        const msg = e instanceof codegen_1.CodegenError ? e.message : e instanceof Error ? e.message : String(e);
        err(ctx, "code-generation", `expression resolution failed (fail-closed): ${msg}`);
        return {
            ok: false,
            logs: ctx.logs,
            errors: ctx.errors,
            durationMs: Date.now() - t0,
            registry: null,
        };
    }
    ok(ctx, "code-generation", `${Object.keys(generated).length} TypeScript modules materialized with all references resolved: ${Object.keys(generated).sort().join(", ")}`, Date.now() - code0);
    // build identity over registries + generated modules
    const all = { ...artifacts, ...Object.fromEntries(Object.entries(generated).map(([k, v]) => [k, v])) };
    const buildIdentity = computeBuildIdentity(all);
    reg.buildIdentity = buildIdentity;
    ok(ctx, "build-identity", `build identity ${buildIdentity}`, undefined);
    const manifest = {
        protocol: reg.protocol.name,
        version: reg.protocol.version,
        corpusHash: ch,
        buildIdentity,
        artifacts: artifactInfo(artifacts),
        generated: artifactInfo(generated),
    };
    const manifestJson = (0, hash_1.stableStringify)(manifest);
    // reproducibility: independent re-materialization must be byte-identical
    const p0 = Date.now();
    const reg2 = buildRegistry(corpus.data, ch, buildIdentity, new Date().toISOString());
    const all2 = { ...buildArtifacts(corpus.data, reg2), ...(0, codegen_1.generateModules)(reg2) };
    const same = (0, hash_1.stableStringify)(all2) === (0, hash_1.stableStringify)(all);
    if (same) {
        ok(ctx, "reproducibility", "independent re-materialization produced byte-identical artifact + module trees", Date.now() - p0);
    }
    else {
        err(ctx, "reproducibility", "reproducibility check failed: artifact trees diverged");
    }
    const counts = {
        commands: Object.keys(reg.commands).length,
        events: Object.keys(reg.events).length,
        machines: Object.keys(reg.machines).length,
        capabilities: Object.keys(reg.capabilities).length,
        gates: Object.keys(reg.gates).length,
        projections: reg.projections.length,
        scenarios: reg.scenarios.length,
        domains: reg.domains.length,
    };
    return {
        ok: ctx.errors.length === 0,
        logs: ctx.logs,
        errors: ctx.errors,
        buildIdentity,
        corpusHash: ch,
        artifacts: { ...artifacts, "build-manifest.json": manifestJson },
        artifactInfo: artifactInfo({ ...artifacts, "build-manifest.json": manifestJson }),
        generated,
        generatedInfo: artifactInfo(generated),
        counts,
        durationMs: Date.now() - t0,
        registry: reg,
    };
}
/** Persist compilation outputs to disk (artifacts + generated modules). */
function writeBuildOutputs(dataDir, result) {
    const artifactsDir = path_1.default.join(dataDir, "artifacts");
    const generatedDir = path_1.default.join(dataDir, "generated");
    fs_1.default.mkdirSync(artifactsDir, { recursive: true });
    fs_1.default.mkdirSync(generatedDir, { recursive: true });
    for (const [name, content] of Object.entries(result.artifacts ?? {})) {
        fs_1.default.writeFileSync(path_1.default.join(artifactsDir, name), content);
    }
    for (const [name, content] of Object.entries(result.generated ?? {})) {
        fs_1.default.writeFileSync(path_1.default.join(generatedDir, name), content);
    }
    return { artifactsDir, generatedDir };
}
