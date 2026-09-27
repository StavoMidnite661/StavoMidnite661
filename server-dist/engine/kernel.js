"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Kernel = void 0;
const eip712_1 = require("../crypto/eip712");
const secp256k1_1 = require("../crypto/secp256k1");
const keccak_1 = require("../crypto/keccak");
const hash_1 = require("../crypto/hash");
/**
 * The SOVR kernel. A thin execution boundary with zero protocol content:
 *
 *   command → resolve → authorize → validate → source → gates → state
 *          → verify → ledger pre-check → create → apply → ledger post
 *          → authz post → events (hash-chained) → transitions → receipt
 *
 * Every decision is either data-driven from the compiled registry
 * (capability lists, payload schemas, states) or a call into a
 * compiler-generated closure. There is no runtime interpretation of
 * protocol content.
 */
class Kernel {
    d;
    constructor(d) {
        this.d = d;
    }
    reject(input, code, reason, stages, ts, extra) {
        const d = this.d;
        if (extra?.missing) {
            d.authz.recordDenial(input.actor, input.command, extra.missing);
            d.events.append({
                type: "AuthorizationDenied",
                entityId: "authz",
                actor: input.actor,
                payload: { identity: input.actor, command: input.command, missing: extra.missing.join(",") },
            });
        }
        d.events.append({
            type: "CommandRejected",
            entityId: "kernel",
            actor: input.actor,
            payload: { command: input.command, actor: input.actor, code, reason },
        });
        const receipt = {
            id: "rcpt-" + (0, hash_1.sha256Hex)((0, hash_1.stableStringify)({ command: input.command, actor: input.actor, ts, code })).slice(0, 14),
            command: input.command,
            actor: input.actor,
            ok: false,
            code,
            reason,
            stages,
            events: [],
            ledgerOps: [],
            buildIdentity: d.registry.buildIdentity,
            ts,
            durationMs: 0,
        };
        d.broadcast({ kind: "receipt", receipt });
        return receipt;
    }
    execute(input) {
        const t0 = Date.now();
        const ts = new Date().toISOString();
        const stages = [];
        const d = this.d;
        const finish = (receipt) => {
            const full = { ...receipt, durationMs: Date.now() - t0 };
            if (full.ok)
                d.broadcast({ kind: "receipt", receipt: full });
            return full;
        };
        // 1 — resolve command from compiled authority
        const handlerFn = d.modules.commandHandlers[input.command];
        if (!handlerFn) {
            stages.push({ name: "resolve", ok: false, ms: 0 });
            return this.reject(input, "COMMAND_UNKNOWN", `command "${input.command}" is not in the compiled command authority`, stages, ts);
        }
        const ctx = {
            payload: input.payload,
            actor: input.actor,
            ts,
            constitutional: !!d.authz.identities.get(input.actor)?.constitutional,
            instance: (id) => {
                const i = d.state.get(id);
                return i ? { id: i.id, machine: i.machine, state: i.state, data: i.data } : null;
            },
            ledgerNextTransferId: () => d.ledger.nextTransferId(),
        };
        let handler;
        try {
            handler = handlerFn(ctx);
        }
        catch (e) {
            stages.push({ name: "resolve", ok: false, ms: 0 });
            return this.reject(input, "VALIDATION_FAILED", `compiled handler evaluation failed: ${e instanceof Error ? e.message : String(e)}`, stages, ts);
        }
        stages.push({ name: "resolve", ok: true, ms: 0, detail: `${handler.id} (${Object.keys(handler.gates).length} gate(s), ${handler.emits.length} emit(s))` });
        // 2 — actor identity
        if (!d.authz.hasIdentity(input.actor)) {
            stages.push({ name: "authorize", ok: false, ms: 0, detail: "unknown identity" });
            return this.reject(input, "ACTOR_UNKNOWN", `actor "${input.actor}" is not a registered identity`, stages, ts);
        }
        // 3 — capability authorization (fail-closed)
        const missing = d.authz.missing(input.actor, handler.capabilities);
        if (missing.length > 0) {
            stages.push({ name: "authorize", ok: false, ms: 0, detail: `missing ${missing.join(", ")}` });
            return this.reject(input, "AUTH_DENIED", `actor "${input.actor}" lacks required capability(ies): ${missing.join(", ")}`, stages, ts, { missing });
        }
        stages.push({ name: "authorize", ok: true, ms: 0, detail: `holds ${handler.capabilities.join(", ") || "(none)"}` });
        // 4 — payload validation against the compiled payload schema
        const validation = [];
        for (const [field, type] of Object.entries(handler.payloadSpec)) {
            const v = input.payload[field];
            if (v === undefined || v === null || (type === "string" && String(v).trim() === "")) {
                validation.push(`field "${field}" is required`);
                continue;
            }
            if (type === "amount" || type === "int") {
                const n = Number(v);
                if (!Number.isInteger(n) || n < 0)
                    validation.push(`field "${field}" must be a non-negative integer`);
            }
            else if (type === "bool" && typeof v !== "boolean") {
                validation.push(`field "${field}" must be a boolean`);
            }
        }
        if (validation.length > 0) {
            stages.push({ name: "validate", ok: false, ms: 0, detail: validation.join("; ") });
            return this.reject(input, "VALIDATION_FAILED", validation.join("; "), stages, ts);
        }
        stages.push({ name: "validate", ok: true, ms: 0, detail: `${Object.keys(handler.payloadSpec).length} field(s) conformed to schema` });
        // 5 — source instance (compiled accessor)
        if (handler.source) {
            const id = handler.source.id(ctx);
            const inst = d.state.get(id);
            if (!inst || inst.machine !== handler.source.machine) {
                stages.push({ name: "state", ok: false, ms: 0, detail: `source instance "${id}" not found` });
                return this.reject(input, "STATE_VIOLATION", `source instance "${id}" (${handler.source.machine}) does not exist`, stages, ts);
            }
            ctx.sourceId = id;
            ctx.sourceData = inst.data;
        }
        // 6 — constitutional gates (compiled evaluators)
        for (const [gateId, fn] of Object.entries(handler.gates)) {
            const g = fn(ctx);
            if (!g.ok) {
                stages.push({ name: "gates", ok: false, ms: 0, detail: g.message });
                return this.reject(input, "GATE_VIOLATION", g.message ?? `gate ${gateId} violated`, stages, ts);
            }
        }
        stages.push({ name: "gates", ok: true, ms: 0, detail: `${Object.keys(handler.gates).length} constitutional gate(s) passed` });
        // 7 — state machine preconditions (compiled accessors + compiled states)
        for (const pre of handler.preconditions) {
            const id = pre.id(ctx);
            const inst = d.state.get(id);
            if (!inst || inst.machine !== pre.machine) {
                stages.push({ name: "state", ok: false, ms: 0, detail: `${pre.machine} instance "${id}" not found` });
                return this.reject(input, "STATE_VIOLATION", `${pre.machine} instance "${id}" does not exist`, stages, ts);
            }
            if (!pre.inStates.includes(inst.state)) {
                stages.push({ name: "state", ok: false, ms: 0, detail: `${inst.id} is "${inst.state}", requires [${pre.inStates.join(", ")}]` });
                return this.reject(input, "STATE_VIOLATION", `instance "${inst.id}" is in state "${inst.state}"; command requires one of [${pre.inStates.join(", ")}]`, stages, ts);
            }
        }
        stages.push({ name: "state", ok: true, ms: 0, detail: `${handler.preconditions.length} precondition(s) satisfied` });
        // 8 — attestation verification (compiled message builder + fixed EIP-712 semantics)
        if (handler.verify) {
            try {
                const spec = handler.verify(ctx);
                const digest = (0, eip712_1.eip712Digest)(spec.domain, spec.types, spec.primaryType, spec.message);
                const digestHex = digest.toString("hex");
                const sigHex = String(input.payload["signature"] ?? "").replace(/^0x/, "");
                if (sigHex.length !== 130)
                    throw new Error("signature must be 65 bytes (r||s||v)");
                // EcSig carries raw 64-hex limbs (no 0x prefix)
                const sig = { r: sigHex.slice(0, 64), s: sigHex.slice(64, 128), v: Number("0x" + sigHex.slice(128, 130)) };
                const recovered = (0, secp256k1_1.recoverPubkey)(digest, sig);
                const recoveredAddr = "0x" + (0, keccak_1.keccak256)(Buffer.from(recovered.slice(2), "hex")).toString("hex").slice(24, 64);
                if (recoveredAddr.toLowerCase() !== String(input.payload["signer"]).toLowerCase()) {
                    throw new Error(`signer mismatch: attestation recovers ${recoveredAddr}, claimed ${input.payload["signer"]}`);
                }
                ctx.verifyDigest = digestHex;
                stages.push({ name: "verify", ok: true, ms: 0, detail: `attestation verified, signer ${String(input.payload["signer"]).slice(0, 10)}…` });
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                stages.push({ name: "verify", ok: false, ms: 0, detail: msg });
                return this.reject(input, "WEB3_INVALID", `attestation verification failed: ${msg}`, stages, ts);
            }
        }
        else {
            stages.push({ name: "verify", ok: true, ms: 0, detail: "no attestation required" });
        }
        // 9 — ledger boundary pre-check (compiled resolver)
        const ledgerOps = [];
        let ledgerPost = null;
        if (handler.ledger) {
            const eff = handler.ledger(ctx);
            if (eff.kind === "transfer") {
                const pErr = d.ledger.prepareTransfer(String(eff.source), String(eff.destination), Number(eff.amount));
                if (pErr) {
                    stages.push({ name: "ledger", ok: false, ms: 0, detail: pErr.message });
                    return this.reject(input, "LEDGER_ERROR", pErr.message, stages, ts);
                }
                ledgerPost = () => {
                    const t = d.ledger.postTransfer(String(eff.source), String(eff.destination), Number(eff.amount), String(eff.memo ?? ""));
                    ledgerOps.push({ kind: "transfer", id: t.id, source: t.source, destination: t.destination, amount: t.amount });
                };
            }
            else if (eff.kind === "create_account") {
                const pErr = d.ledger.prepareCreateAccount(String(eff.account), Number(eff.amount));
                if (pErr) {
                    stages.push({ name: "ledger", ok: false, ms: 0, detail: pErr.message });
                    return this.reject(input, "LEDGER_ERROR", pErr.message, stages, ts);
                }
                ledgerPost = () => {
                    const r = d.ledger.postCreateAccount(String(eff.account), String(eff.name ?? eff.account), input.actor, Number(eff.amount));
                    ledgerOps.push({ kind: "create_account", account: eff.account, opening: Number(eff.amount), transferId: r.transferId });
                };
            }
            stages.push({ name: "ledger", ok: true, ms: 0, detail: `ledger ${eff.kind} pre-checked${Number(eff.amount) > 0 ? ` (${eff.amount} μSOVR)` : ""}` });
        }
        else {
            stages.push({ name: "ledger", ok: true, ms: 0, detail: "no ledger effect" });
        }
        // 10 — create entity (compiled accessor)
        if (handler.create) {
            const id = handler.create.id(ctx);
            if (d.state.get(id)) {
                stages.push({ name: "execute", ok: false, ms: 0, detail: `entity "${id}" already exists` });
                return this.reject(input, "VALIDATION_FAILED", `entity "${id}" already exists (duplicate id)`, stages, ts);
            }
            d.state.create(handler.create.machine, id, {});
            d.state.setInitial(id, d.registry.machines[handler.create.machine]);
        }
        // 11 — apply compiled data effects, capturing the before-state so the
        // mutation can be durably recorded as a system InstanceState event
        const refIds = new Set();
        if (ctx.sourceId)
            refIds.add(ctx.sourceId);
        for (const pre of handler.preconditions) {
            const id = pre.id(ctx);
            if (d.state.get(id))
                refIds.add(id);
        }
        if (handler.create)
            refIds.add(handler.create.id(ctx));
        const beforeData = {};
        for (const id of refIds) {
            const inst = d.state.get(id);
            if (inst)
                beforeData[id] = (0, hash_1.stableStringify)(inst.data);
        }
        for (const apply of handler.applies)
            apply(ctx);
        // 12 — post ledger effect (pre-checked)
        if (ledgerPost)
            ledgerPost();
        // 13 — post compiled authorization effect
        if (handler.authz) {
            const eff = handler.authz(ctx);
            d.authz.apply(eff.kind, input.actor, eff.target, eff.capability);
            ledgerOps.push({ kind: "authz_" + eff.kind, target: eff.target, capability: eff.capability });
        }
        // 14 — durable record of instance-data mutations (generic diff — the
        // kernel records WHAT changed, never WHY; replay re-applies it verbatim)
        const emitted = [];
        for (const id of [...refIds].sort()) {
            const inst = d.state.get(id);
            if (!inst || inst.data === undefined)
                continue;
            const after = (0, hash_1.stableStringify)(inst.data);
            if (beforeData[id] === after)
                continue;
            const changes = {};
            const beforeObj = (beforeData[id] ? JSON.parse(beforeData[id]) : {});
            const afterObj = JSON.parse(after);
            for (const [k, v] of Object.entries(afterObj)) {
                if (!Object.prototype.hasOwnProperty.call(beforeObj, k) || JSON.stringify(beforeObj[k]) !== JSON.stringify(v))
                    changes[k] = v;
            }
            const stored = d.events.append({
                type: "InstanceState",
                entityId: id,
                actor: input.actor,
                payload: { changes },
                affected: [{ id, machine: inst.machine }],
            });
            if (!inst.createdAt)
                inst.createdAt = stored.ts;
            emitted.push({ seq: stored.seq, type: "InstanceState", hash: stored.hash });
            d.projections.onEvent(stored);
            d.broadcast({ kind: "event", event: stored });
        }
        // 15 — emit protocol events (compiled payload builders), apply compiled transitions
        for (const emit of handler.emits) {
            if (emit.when && !emit.when(ctx))
                continue;
            const evDef = d.registry.events[emit.event];
            if (!evDef)
                continue;
            const payload = emit.payload(ctx);
            // type-conform the event payload against the compiled event schema
            for (const [field, type] of Object.entries(evDef.payload)) {
                if (payload[field] === undefined)
                    continue;
                if (type === "amount" || type === "int")
                    payload[field] = Number(payload[field]);
                else if (type === "bool")
                    payload[field] = Boolean(payload[field]);
                else
                    payload[field] = String(payload[field]);
            }
            const affected = [];
            for (const id of [...refIds].sort()) {
                const inst = d.state.get(id);
                if (!inst)
                    continue;
                if (!d.modules.transitions[inst.machine]?.[emit.event])
                    continue;
                affected.push({ id, machine: inst.machine });
            }
            const stored = d.events.append({
                type: emit.event,
                entityId: ctx.sourceId ?? (handler.create ? handler.create.id(ctx) : "kernel"),
                actor: input.actor,
                payload,
                affected,
            });
            emitted.push({ seq: stored.seq, type: emit.event, hash: stored.hash });
            for (const a of affected) {
                const inst = d.state.get(a.id);
                if (!inst)
                    continue;
                if (!inst.createdAt)
                    inst.createdAt = stored.ts;
                const matches = (d.modules.transitions[a.machine]?.[emit.event] ?? []).filter((t) => t.from.includes(inst.state));
                if (matches.length > 0)
                    inst.state = matches[matches.length - 1].to;
            }
            d.projections.onEvent(stored);
            d.broadcast({ kind: "event", event: stored });
        }
        stages.push({ name: "execute", ok: true, ms: Date.now() - t0, detail: `${emitted.length} event(s) emitted, ${ledgerOps.length} effect(s)` });
        return finish({
            id: "rcpt-" + (0, hash_1.sha256Hex)((0, hash_1.stableStringify)({ command: input.command, actor: input.actor, ts, seqs: emitted.map((e) => e.seq) })).slice(0, 14),
            command: input.command,
            actor: input.actor,
            ok: true,
            code: "OK",
            stages,
            events: emitted,
            ledgerOps,
            buildIdentity: d.registry.buildIdentity,
            ts,
        });
    }
}
exports.Kernel = Kernel;
