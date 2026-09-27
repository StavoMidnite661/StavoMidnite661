import fs from "fs";
import path from "path";
import { sha256Hex, stableStringify } from "../crypto/hash";
import type { Runtime } from "./runtime";
import type { ScenarioDef, ScenarioReport, ScenarioStepReport } from "./types";

/**
 * Simulation runner: executes corpus-defined scenarios end-to-end through
 * the real kernel, asserting the expected outcome of every step. The
 * report is hashed into an evidence artifact.
 */
export class Simulations {
  reports: ScenarioReport[] = [];
  private file: string;

  constructor(private rt: Runtime) {
    this.file = path.join(__dirname, "..", "data", "sim-reports.json");
    if (fs.existsSync(this.file)) {
      this.reports = JSON.parse(fs.readFileSync(this.file, "utf8"));
    }
  }

  private persist(): void {
    this.reports = this.reports.slice(-25);
    fs.writeFileSync(this.file, JSON.stringify(this.reports, null, 2));
  }

  private substitute<T>(v: T, run: string): T {
    if (typeof v === "string") return v.split("{{run}}").join(run) as T;
    if (Array.isArray(v)) return v.map((x) => this.substitute(x, run)) as T;
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = this.substitute(val, run);
      return out as T;
    }
    return v;
  }

  private matches(step: { expect: string }, code: string, ok: boolean): boolean {
    if (step.expect === "ok") return ok && code === "OK";
    if (step.expect === "denied") return !ok && code === "AUTH_DENIED";
    if (step.expect === "rejected") {
      return !ok && ["VALIDATION_FAILED", "GATE_VIOLATION", "STATE_VIOLATION", "WEB3_INVALID", "LEDGER_ERROR"].includes(code);
    }
    return false;
  }

  run(scenarioId: string): ScenarioReport {
    const sc: ScenarioDef | undefined = this.rt.registry.scenarios.find((s) => s.id === scenarioId);
    if (!sc) throw new Error(`scenario "${scenarioId}" not found`);
    const run = "run" + Date.now().toString(36);
    const startedAt = new Date().toISOString();
    const steps: ScenarioStepReport[] = [];

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
        } else if (step.verify === "replay") {
          const r = this.rt.replayVerify();
          ok = r.ok;
          got = r.ok ? "replay-match" : "replay-diverged";
          detail = `${r.events} events replayed`;
        } else {
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
        const values: Record<string, unknown> = {};
        const orderRef = w3.types[w3.primaryType].find((f) => payload[f.name] !== undefined && this.rt.state.get(String(payload[f.name])));
        const order = orderRef ? this.rt.state.get(String(payload[orderRef.name])) : undefined;
        for (const f of w3.types[w3.primaryType]) {
          if (f.name === "timestamp") values[f.name] = "harness-" + Date.now().toString(36);
          else if (payload[f.name] !== undefined) values[f.name] = payload[f.name];
          else if (order && order.data[f.name] !== undefined) values[f.name] = order.data[f.name];
        }
        const signed = this.rt.web3.signForCommand(step.command!, values, key);
        payload.signature = signed.signature;
        payload.signer = signed.signer;
        payload.timestamp = signed.timestamp;
        delete payload.signingKey;
      }

      const receipt = this.rt.kernel.execute({ command: step.command!, actor: step.actor!, payload });
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
    const report: ScenarioReport = {
      reportId: "sr-" + sha256Hex(stableStringify(body)).slice(0, 12),
      scenarioId,
      name: sc.name,
      run,
      startedAt,
      finishedAt: body.finishedAt,
      steps,
      passed,
      evidence: "sha256:" + sha256Hex(stableStringify(body)),
    };
    this.reports.unshift(report);
    this.persist();
    return report;
  }
}
