"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Simulations = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hash_1 = require("../crypto/hash");
/**
 * Simulation runner: executes corpus-defined scenarios end-to-end through
 * the real kernel, asserting the expected outcome of every step. The
 * report is hashed into an evidence artifact.
 */
class Simulations {
    rt;
    reports = [];
    file;
    constructor(rt) {
        this.rt = rt;
        this.file = path_1.default.join(__dirname, "..", "data", "sim-reports.json");
        if (fs_1.default.existsSync(this.file)) {
            this.reports = JSON.parse(fs_1.default.readFileSync(this.file, "utf8"));
        }
    }
    persist() {
        this.reports = this.reports.slice(-25);
        fs_1.default.writeFileSync(this.file, JSON.stringify(this.reports, null, 2));
    }
    substitute(v, run) {
        if (typeof v === "string")
            return v.split("{{run}}").join(run);
        if (Array.isArray(v))
            return v.map((x) => this.substitute(x, run));
        if (v && typeof v === "object") {
            const out = {};
            for (const [k, val] of Object.entries(v))
                out[k] = this.substitute(val, run);
            return out;
        }
        return v;
    }
    matches(step, code, ok) {
        if (step.expect === "ok")
            return ok && code === "OK";
        if (step.expect === "denied")
            return !ok && code === "AUTH_DENIED";
        if (step.expect === "rejected") {
            return !ok && ["VALIDATION_FAILED", "GATE_VIOLATION", "STATE_VIOLATION", "WEB3_INVALID", "LEDGER_ERROR"].includes(code);
        }
        return false;
    }
    run(scenarioId) {
        const sc = this.rt.registry.scenarios.find((s) => s.id === scenarioId);
        if (!sc)
            throw new Error(`scenario "${scenarioId}" not found`);
        const run = "run" + Date.now().toString(36);
        const startedAt = new Date().toISOString();
        const steps = [];
        sc.steps.forEach((raw, i) => {
            const step = this.substitute(raw, run);
            if (step.verify) {
                let got = "ok";
                let detail = "";
                let ok = true;
                if (step.verify === "chain") {
                    const r = this.rt.events.verify();
                    ok = r.ok;
                    got = r.ok ? "chain-verified" : "chain-broken";
                    detail = r.ok ? `${r.checked} events verified` : `broken at seq ${r.brokenAt}`;
                }
                else if (step.verify === "replay") {
                    const r = this.rt.replayVerify();
                    ok = r.ok;
                    got = r.ok ? "replay-match" : "replay-diverged";
                    detail = `${r.events} events replayed`;
                }
                else {
                    const r = this.rt.ledger.verify();
                    ok = r.doubleEntry && r.balancesMatch && r.supplyInvariant;
                    got = ok ? "ledger-invariant" : "ledger-violated";
                    detail = `${r.transfers} transfers, supply ${r.supplyInvariant ? "stable" : "broken"}`;
                }
                // Normalize the verification result to the receipt code language
                const code = ok ? "OK" : "VERIFY_FAILED";
                const pass = this.matches(step, code, ok);
                steps.push({ i: i + 1, verify: step.verify, expect: step.expect, got, ok: pass, detail });
                return;
            }
            const payload = { ...(step.payload ?? {}) };
            // harness automation: sign the EIP-712 attestation for web3 steps.
            // Field values are resolved generically against the compiled attestation
            // type: field name -> payload -> source instance data.
            if (payload.signingKey) {
                const key = String(payload.signingKey);
                const w3 = this.rt.registry.protocol.web3;
                if (!w3) {
                    steps.push({ i: i + 1, command: step.command, actor: step.actor, expect: step.expect, got: "harness-error", ok: false, detail: "no web3 attestation spec in protocol" });
                    return;
                }
                const values = {};
                const orderRef = w3.types[w3.primaryType].find((f) => payload[f.name] !== undefined && this.rt.state.get(String(payload[f.name])));
                const order = orderRef ? this.rt.state.get(String(payload[orderRef.name])) : undefined;
                for (const f of w3.types[w3.primaryType]) {
                    if (f.name === "timestamp")
                        values[f.name] = "harness-" + Date.now().toString(36);
                    else if (payload[f.name] !== undefined)
                        values[f.name] = payload[f.name];
                    else if (order && order.data[f.name] !== undefined)
                        values[f.name] = order.data[f.name];
                }
                const signed = this.rt.web3.signForCommand(step.command, values, key);
                payload.signature = signed.signature;
                payload.signer = signed.signer;
                payload.timestamp = signed.timestamp;
                delete payload.signingKey;
            }
            const receipt = this.rt.kernel.execute({ command: step.command, actor: step.actor, payload });
            const pass = this.matches(step, receipt.code, receipt.ok);
            steps.push({
                i: i + 1,
                command: step.command,
                actor: step.actor,
                expect: step.expect,
                got: receipt.code,
                ok: pass,
                detail: receipt.ok ? `${receipt.events.length} event(s)` : receipt.reason,
            });
        });
        const passed = steps.every((s) => s.ok);
        const body = { scenarioId, run, startedAt, finishedAt: new Date().toISOString(), steps, passed };
        const report = {
            reportId: "sr-" + (0, hash_1.sha256Hex)((0, hash_1.stableStringify)(body)).slice(0, 12),
            scenarioId,
            name: sc.name,
            run,
            startedAt,
            finishedAt: body.finishedAt,
            steps,
            passed,
            evidence: "sha256:" + (0, hash_1.sha256Hex)((0, hash_1.stableStringify)(body)),
        };
        this.reports.unshift(report);
        this.persist();
        return report;
    }
}
exports.Simulations = Simulations;
