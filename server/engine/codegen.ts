import { stableStringify } from "../crypto/hash";
import type { CommandDef, EventDef, GateDef, GateRef, Registry } from "./types";

/**
 * Deterministic TypeScript code generation — the materialization of the
 * compiled IR into closed, executable authority.
 *
 * STRICTNESS: every protocol reference (payload field, source-instance data
 * path, derived token, gate wiring) is RESOLVED AT COMPILE TIME into a
 * closure. The generated modules contain no protocol strings for the
 * runtime to interpret; the kernel calls functions and reads tables only.
 * Any expression that cannot be resolved is a compile error (fail-closed).
 */

export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodegenError";
  }
}

interface CmdCtxGen {
  id: string;
  payloadFields: string[];
  alias?: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function j(s: string): string {
  return JSON.stringify(s);
}

/**
 * Resolve a protocol expression into generated code. Throws CodegenError
 * on anything that cannot be resolved — compilation fails closed.
 */
function cexpr(expr: unknown, type: string, c: CmdCtxGen, where: string): string {
  const render = (raw: unknown): string => {
    if (typeof raw === "number" || typeof raw === "boolean") return JSON.stringify(raw);
    if (Array.isArray(raw) || (raw !== null && typeof raw === "object")) return JSON.stringify(raw);
    if (typeof raw !== "string") throw new CodegenError(`${c.id} ${where}: non-expressible value`);
    const s = raw;
    if (s === "actor") return "ctx.actor";
    if (s.startsWith("@")) {
      const f = s.slice(1);
      if (!IDENT.test(f) || !c.payloadFields.includes(f)) {
        throw new CodegenError(`${c.id} ${where}: "@${f}" does not resolve to a declared payload field`);
      }
      return `ctx.payload[${j(f)}]`;
    }
    if (s.startsWith("derived.")) {
      const m = /^derived\.([a-zA-Z]+)(?:\((.*)\))?$/.exec(s);
      if (!m) throw new CodegenError(`${c.id} ${where}: malformed derived expression "${s}"`);
      const [ , token, inner] = m;
      switch (token) {
        case "signature":
          return "sha256Hex(stableStringify(ctx.payload))";
        case "now":
          return "ctx.ts";
        case "transferId":
          return "ctx.ledgerNextTransferId()";
        case "digest":
          return "String(ctx.verifyDigest ?? \"\")";
        case "attestationId":
          return `"att-" + String(ctx.verifyDigest ?? "").slice(0, 16)`;
        case "address":
          if (inner === undefined) throw new CodegenError(`${c.id} ${where}: derived.address requires an argument`);
          return `toAddress(String(${render(inner)}))`;
        case "hash":
          if (inner === undefined) throw new CodegenError(`${c.id} ${where}: derived.hash requires an argument`);
          return `sha256Hex(stableStringify(${render(inner)}))`;
        default:
          throw new CodegenError(`${c.id} ${where}: unknown derived token "${token}"`);
      }
    }
    if (c.alias) {
      if (s === c.alias) throw new CodegenError(`${c.id} ${where}: "${s}" alone does not address a data field`);
      if (s.startsWith(c.alias + ".")) {
        const path = s.slice(c.alias.length + 1).split(".");
        if (path.some((p) => !IDENT.test(p))) throw new CodegenError(`${c.id} ${where}: malformed data path "${s}"`);
        return `ctx.sourceData` + path.map((p) => `[${j(p)}]`).join("");
      }
    }
    if (c.payloadFields.includes(s)) return `ctx.payload[${j(s)}]`;
    // literal
    return j(s);
  };
  const body = render(expr);
  if (type === "amount" || type === "int") return `Number(${body})`;
  if (type === "bool") return `Boolean(${body})`;
  return `String(${body})`;
}

function coerce(valueExpr: string, type: string): string {
  if (type === "amount" || type === "int") return `Number(${valueExpr})`;
  if (type === "bool") return `Boolean(${valueExpr})`;
  return `String(${valueExpr})`;
}

// ---------------------------------------------------------------- helpers.ts

function genHelpers(): string {
  return [
    "import { createHash } from \"node:crypto\";",
    "",
    "export function sha256Hex(input: string | Buffer): string {",
    "  return createHash(\"sha256\").update(input).digest(\"hex\");",
    "}",
    "",
    "export function stableStringify(value: unknown): string {",
    "  const walk = (v: unknown): unknown => {",
    "    if (v === undefined) return null;",
    "    if (Array.isArray(v)) return v.map(walk);",
    "    if (v !== null && typeof v === \"object\") {",
    "      const out: Record<string, unknown> = {};",
    "      for (const k of Object.keys(v as Record<string, unknown>).sort()) {",
    "        const val = (v as Record<string, unknown>)[k];",
    "        if (val !== undefined) out[k] = walk(val);",
    "      }",
    "      return out;",
    "    }",
    "    return v;",
    "  };",
    "  return JSON.stringify(walk(value === undefined ? null : value));",
    "}",
    "",
    "export function toAddress(name: string): string {",
    "  return \"0x\" + sha256Hex(\"sovr:addr:\" + name).slice(0, 40);",
    "}",
    "",
    "export function addressOf(s: string): string {",
    "  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s : toAddress(s);",
    "}",
    "",
    "export interface InstanceView {",
    "  id: string;",
    "  machine: string;",
    "  state: string;",
    "  data: Record<string, unknown>;",
    "}",
    "",
    "export interface ExecCtx {",
    "  payload: Record<string, unknown>;",
    "  actor: string;",
    "  ts: string;",
    "  constitutional: boolean;",
    "  sourceId?: string;",
    "  sourceData?: Record<string, unknown>;",
    "  verifyDigest?: string;",
    "  instance(id: string): InstanceView | null;",
    "  ledgerNextTransferId(): string;",
    "}",
    "",
    "export interface HandlerPrecondition {",
    "  machine: string;",
    "  id: (ctx: ExecCtx) => string;",
    "  inStates: string[];",
    "}",
    "",
    "export interface HandlerVerifySpec {",
    "  domain: Record<string, unknown>;",
    "  types: Record<string, { name: string; type: string }[]>;",
    "  primaryType: string;",
    "  message: Record<string, unknown>;",
    "}",
    "",
    "export interface GateResult {",
    "  ok: boolean;",
    "  code?: string;",
    "  message?: string;",
    "}",
    "",
    "export interface CommandHandler {",
    "  id: string;",
    "  capabilities: string[];",
    "  payloadSpec: Record<string, string>;",
    "  source: { machine: string; id: (ctx: ExecCtx) => string } | null;",
    "  preconditions: HandlerPrecondition[];",
    "  create: { machine: string; id: (ctx: ExecCtx) => string } | null;",
    "  applies: ((ctx: ExecCtx) => void)[];",
    "  ledger: ((ctx: ExecCtx) => Record<string, unknown>) | null;",
    "  authz: ((ctx: ExecCtx) => { kind: string; target: string; capability: string }) | null;",
    "  verify: ((ctx: ExecCtx) => HandlerVerifySpec) | null;",
    "  gates: Record<string, (ctx: ExecCtx) => GateResult>;",
    "  emits: { event: string; payload: (ctx: ExecCtx) => Record<string, unknown>; when: ((ctx: ExecCtx) => boolean) | null }[];",
    "}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- transitions.ts

function genTransitions(reg: Registry): string {
  // A machine may declare several entries for one event (e.g. CollateralPosted
  // is both a create self-loop and an activation); keep them all, in order.
  const table: Record<string, Record<string, { from: string[]; to: string }[]>> = {};
  for (const m of Object.values(reg.machines)) {
    table[m.id] = {};
    for (const t of m.transitions) {
      const entry = { from: t.from ?? [...m.states], to: t.to };
      if (!table[m.id][t.event]) table[m.id][t.event] = [];
      table[m.id][t.event].push(entry);
    }
  }
  return (
    header(reg.corpusHash, "transitions.ts") +
    "export const transitions: Record<string, Record<string, { from: string[]; to: string }[]>> = " +
    stableStringify(table) +
    ";\n"
  );
}

// ---------------------------------------------------------------- command-handlers.ts

/** Data fields that exist on each machine's instances (set by any compiled data effect). */
function machineDataFields(reg: Registry): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const c of Object.values(reg.commands)) {
    for (const de of c.dataEffects ?? []) {
      if (!out.has(de.machine)) out.set(de.machine, new Set());
      out.get(de.machine)!.add(de.field);
    }
  }
  return out;
}

function genGateFunction(cmd: CommandDef, gateId: string, gate: GateDef, ref: GateRef, dataFields: Map<string, Set<string>>): string {
  const c: CmdCtxGen = {
    id: cmd.id,
    payloadFields: Object.keys(cmd.payload),
    alias: cmd.sourceInstance?.alias,
  };
  const where = `gate ${gateId}`;
  const fail = (msg: string) =>
    `return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + (${msg}) };`;
  const L: string[] = [];

  const refField = (machine: string, field: string, label: string): string => {
    const set = dataFields.get(machine);
    if (!set || !set.has(field)) {
      throw new CodegenError(`${cmd.id} ${where}: gate references "${label}" but no data effect sets field "${field}" on machine ${machine}`);
    }
    return j(field);
  };

  const idFrom = ref.idFrom ? cexpr(ref.idFrom, "string", c, `${where} idFrom`) : undefined;
  const amountFrom = ref.amountFrom ? cexpr(ref.amountFrom, "amount", c, `${where} amountFrom`) : undefined;
  const capFrom = ref.capabilityFrom ? cexpr(ref.capabilityFrom, "string", c, `${where} capabilityFrom`) : undefined;

  switch (gate.rule) {
    case "max_amount": {
      if (!amountFrom) throw new CodegenError(`${cmd.id} ${where}: max_amount requires amountFrom`);
      L.push(`const amount = Number(${amountFrom});`);
      L.push(`if (!Number.isInteger(amount) || amount > ${gate.limit}) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + String(amount) + ${j(` exceeds constitutional limit `)} + ${gate.limit} };`);
      break;
    }
    case "no_self_settlement": {
      const machine = gate.refs!.machine!;
      const field = refField(machine, gate.refs!.field!, "proposer field");
      if (!idFrom) throw new CodegenError(`${cmd.id} ${where}: no_self_settlement requires idFrom`);
      L.push(`const inst = ctx.instance(${idFrom});`);
      L.push(`if (!inst) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "instance not found" };`);
      L.push(`if (String(inst.data[${field}]) === ctx.actor) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "actor is the settlement proposer" };`);
      break;
    }
    case "credit_headroom": {
      const machine = gate.refs!.machine!;
      const limitF = refField(machine, gate.refs!.limitField!, "limit field");
      const outF = refField(machine, gate.refs!.outstandingField!, "outstanding field");
      if (!idFrom || !amountFrom) throw new CodegenError(`${cmd.id} ${where}: credit_headroom requires idFrom and amountFrom`);
      L.push(`const inst = ctx.instance(${idFrom});`);
      L.push(`if (!inst) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "facility instance not found" };`);
      L.push(`const outstanding = Number(inst.data[${outF}]);`);
      L.push(`const limit = Number(inst.data[${limitF}]);`);
      L.push(`const amount = Number(${amountFrom});`);
      L.push(`if (outstanding + amount > limit) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + (outstanding + amount) + ${j(" would exceed facility limit ")} + String(limit) };`);
      break;
    }
    case "liquidation_utilization": {
      const machine = gate.refs!.machine!;
      const expF = refField(machine, gate.refs!.exposureField!, "exposure field");
      const amtF = refField(machine, gate.refs!.amountField!, "amount field");
      if (!idFrom) throw new CodegenError(`${cmd.id} ${where}: liquidation_utilization requires idFrom`);
      L.push(`const inst = ctx.instance(${idFrom});`);
      L.push(`if (!inst) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "position instance not found" };`);
      L.push(`const exposure = Number(inst.data[${expF}]);`);
      L.push(`const amount = Number(inst.data[${amtF}]);`);
      L.push(`if (amount <= 0) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "position has no collateral amount" };`);
      L.push(`if (exposure / amount < ${gate.threshold}) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + (exposure / amount).toFixed(4) + ${j(" is below the liquidation threshold ")} + ${gate.threshold} };`);
      break;
    }
    case "meta_grant_protection": {
      if (!capFrom) throw new CodegenError(`${cmd.id} ${where}: meta_grant_protection requires capabilityFrom`);
      L.push(`const cap = ${capFrom};`);
      L.push(`if (cap === ${j(gate.refs!.metaCapability!)} && !ctx.constitutional) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "meta capability grants are restricted to the constitutional identity" };`);
      break;
    }
    case "repay_within_outstanding": {
      const machine = gate.refs!.machine!;
      const outF = refField(machine, gate.refs!.outstandingField!, "outstanding field");
      if (!idFrom || !amountFrom) throw new CodegenError(`${cmd.id} ${where}: repay_within_outstanding requires idFrom and amountFrom`);
      L.push(`const inst = ctx.instance(${idFrom});`);
      L.push(`if (!inst) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "facility instance not found" };`);
      L.push(`const outstanding = Number(inst.data[${outF}]);`);
      L.push(`const amount = Number(${amountFrom});`);
      L.push(`if (outstanding < amount) return { ok: false, code: "GATE_VIOLATION", message: ${j(`${gate.id} ${gate.name}: `)} + "repayment " + String(amount) + ${j(" exceeds outstanding ")} + String(outstanding) };`);
      break;
    }
  }
  L.push("return { ok: true };");
  return L.join("\n      ");
}

function genCommandHandler(reg: Registry, cmd: CommandDef, dataFields: Map<string, Set<string>>): string {
  const c: CmdCtxGen = {
    id: cmd.id,
    payloadFields: Object.keys(cmd.payload),
    alias: cmd.sourceInstance?.alias,
  };
  const L: string[] = [];
  L.push(`"${cmd.id}": function (ctx: ExecCtx): CommandHandler {`);
  L.push(`  return {`);
  L.push(`    id: ${j(cmd.id)},`);
  L.push(`    capabilities: ${JSON.stringify(cmd.capabilities)},`);
  L.push(`    payloadSpec: ${JSON.stringify(cmd.payload)},`);

  // source
  if (cmd.sourceInstance) {
    const idExpr = cexpr(cmd.sourceInstance.idFrom, "string", c, "sourceInstance.idFrom");
    // static check: source machine is a real machine (compiler-validated)
    L.push(`    source: { machine: ${j(cmd.sourceInstance.machine)}, id: () => ${idExpr} },`);
  } else {
    L.push(`    source: null,`);
  }

  // preconditions
  if (cmd.preconditions.length === 0) {
    L.push(`    preconditions: [],`);
  } else {
    L.push(`    preconditions: [`);
    for (const pre of cmd.preconditions) {
      const idExpr = cexpr(pre.idFrom, "string", c, `precondition ${pre.machine}`);
      L.push(`      { machine: ${j(pre.machine)}, id: () => ${idExpr}, inStates: ${JSON.stringify(pre.inStates)} },`);
    }
    L.push(`    ],`);
  }

  // create
  if (cmd.creates) {
    const idExpr = cexpr(cmd.creates.idFrom, "string", c, "creates.idFrom");
    L.push(`    create: { machine: ${j(cmd.creates.machine)}, id: () => ${idExpr} },`);
  } else {
    L.push(`    create: null,`);
  }

  // data effects -> closed apply functions
  if (!cmd.dataEffects || cmd.dataEffects.length === 0) {
    L.push(`    applies: [],`);
  } else {
    L.push(`    applies: [`);
    for (const de of cmd.dataEffects) {
      const idExpr = cexpr(de.idFrom, "string", c, `dataEffect ${de.field}`);
      L.push(`      () => {`);
      L.push(`        const inst = ctx.instance(${idExpr});`);
      L.push(`        if (!inst) return;`);
      if (typeof de.value === "string" && (de.value.startsWith("@") || de.value.startsWith("derived.") || de.value === "actor" || (c.alias && de.value.startsWith(c.alias + ".")) || c.payloadFields.includes(de.value))) {
        const vExpr = cexpr(de.value, de.op === "add" || de.op === "sub" ? "amount" : "string", c, `dataEffect ${de.field} value`);
        switch (de.op) {
          case "set":
            L.push(`        inst.data[${j(de.field)}] = ${vExpr};`);
            break;
          case "add":
            L.push(`        inst.data[${j(de.field)}] = Number(inst.data[${j(de.field)}] ?? 0) + Number(${vExpr});`);
            break;
          case "sub":
            L.push(`        inst.data[${j(de.field)}] = Number(inst.data[${j(de.field)}] ?? 0) - Number(${vExpr});`);
            break;
          case "push":
            L.push(`        inst.data[${j(de.field)}] = [...((inst.data[${j(de.field)}] as unknown[]) ?? []), ${vExpr}];`);
            break;
        }
      } else {
        // literal value (number / array / plain string literal)
        const lit = JSON.stringify(de.value);
        switch (de.op) {
          case "set":
            L.push(`        inst.data[${j(de.field)}] = ${lit};`);
            break;
          case "push":
            L.push(`        inst.data[${j(de.field)}] = [...((inst.data[${j(de.field)}] as unknown[]) ?? []), ${lit}];`);
            break;
          case "add":
          case "sub": {
            const n = Number(de.value);
            if (!Number.isFinite(n)) throw new CodegenError(`${cmd.id}: dataEffect ${de.field} numeric op requires a numeric literal`);
            L.push(`        inst.data[${j(de.field)}] = Number(inst.data[${j(de.field)}] ?? 0) ${de.op === "add" ? "+" : "-"} ${n};`);
            break;
          }
        }
      }
      L.push(`      },`);
    }
    L.push(`    ],`);
  }

  // ledger effect
  if (cmd.ledger) {
    const le = cmd.ledger;
    L.push(`    ledger: (ctx: ExecCtx) => {`);
    const parts: string[] = [`      const out: Record<string, unknown> = {}`];
    parts.push(`      out["kind"] = ${j(le.kind)}`);
    if (le.kind === "transfer") {
      parts.push(`      out["source"] = ${cexpr(le.source!, "string", c, "ledger.source")}`);
      parts.push(`      out["destination"] = ${cexpr(le.destination!, "string", c, "ledger.destination")}`);
    } else {
      parts.push(`      out["account"] = ${cexpr(le.account!, "string", c, "ledger.account")}`);
      parts.push(`      out["name"] = ${cexpr(le.name ?? le.account!, "string", c, "ledger.name")}`);
    }
    parts.push(`      out["amount"] = ${cexpr(le.amount, "amount", c, "ledger.amount")}`);
    if (le.memo) parts.push(`      out["memo"] = ${cexpr(le.memo, "string", c, "ledger.memo")}`);
    L.push(parts.join(";\n"));
    L.push(`      return out;`);
    L.push(`    },`);
  } else {
    L.push(`    ledger: null,`);
  }

  // authz effect
  if (cmd.authz) {
    const a = cmd.authz;
    L.push(`    authz: (ctx: ExecCtx) => {`);
    L.push(`      return { kind: ${j(a.kind)}, target: ${cexpr(a.targetFrom, "string", c, "authz.target")}, capability: ${cexpr(a.capabilityFrom, "string", c, "authz.capability")} };`);
    L.push(`    },`);
  } else {
    L.push(`    authz: null,`);
  }

  // verify (EIP-712) — fully resolved message builder
  if (cmd.verify) {
    const w3 = reg.protocol.web3!;
    L.push(`    verify: (ctx: ExecCtx) => {`);
    L.push(`      const message: Record<string, unknown> = {};`);
    for (const f of w3.types[w3.primaryType]) {
      const expr = cmd.verify.fields[f.name];
      if (expr === undefined) throw new CodegenError(`${cmd.id}: verify spec missing expression for typed field "${f.name}"`);
      if (f.type === "address") {
        L.push(`      message[${j(f.name)}] = addressOf(${cexpr(expr, "string", c, `verify ${f.name}`)});`);
      } else {
        L.push(`      message[${j(f.name)}] = ${cexpr(expr, f.type, c, `verify ${f.name}`)};`);
      }
    }
    L.push(`      return { domain: ${stableStringify(w3.domain)}, types: ${stableStringify(w3.types)}, primaryType: ${j(w3.primaryType)}, message };`);
    L.push(`    },`);
  } else {
    L.push(`    verify: null,`);
  }

  // gates
  if (!cmd.gates || cmd.gates.length === 0) {
    L.push(`    gates: {},`);
  } else {
    L.push(`    gates: {`);
    for (const ref of cmd.gates) {
      const gate = reg.gates[ref.id];
      const body = genGateFunction(cmd, ref.id, gate, ref, dataFields);
      L.push(`      ${j(ref.id)}: (ctx: ExecCtx) => {`);
      L.push(`        ${body}`);
      L.push(`      },`);
    }
    L.push(`    },`);
  }

  // emits
  if (cmd.emits.length === 0) {
    L.push(`    emits: [],`);
  } else {
    L.push(`    emits: [`);
    for (const emit of cmd.emits) {
      const evDef: EventDef = reg.events[emit.event];
      L.push(`      { event: ${j(emit.event)},`);
      // payload closure
      const fields: string[] = [];
      for (const [field, type] of Object.entries(evDef.payload)) {
        const spec = emit.payload?.[field];
        if (spec === undefined) {
          if (c.payloadFields.includes(field)) {
            fields.push(`        ${j(field)}: ${coerce(`ctx.payload[${j(field)}]`, type)},`);
          }
          continue; // optional field, not provided
        }
        fields.push(`        ${j(field)}: ${cexpr(spec, type, c, `emit ${emit.event}.${field}`)},`);
      }
      L.push(`        payload: (ctx: ExecCtx) => ({`);
      for (const f of fields) L.push(f);
      L.push(`        }),`);
      // when closure
      if (emit.when === "outstanding_zero") {
        const subs = (cmd.dataEffects ?? []).filter((de) => de.op === "sub" && de.field === "outstanding");
        if (subs.length !== 1) throw new CodegenError(`${cmd.id}: when=outstanding_zero requires exactly one data effect subtracting "outstanding"`);
        const de = subs[0];
        const idExpr = cexpr(de.idFrom, "string", c, "when outstanding_zero");
        L.push(`        when: (ctx: ExecCtx) => { const inst = ctx.instance(${idExpr}); return !!inst && Number(inst.data["outstanding"]) === 0; },`);
      } else if (emit.when === "outcome_passed" || emit.when === "outcome_rejected") {
        if (!c.payloadFields.includes("outcome")) throw new CodegenError(`${cmd.id}: when=outcome_* requires payload field "outcome"`);
        const want = emit.when === "outcome_passed" ? "passed" : "rejected";
        L.push(`        when: (ctx: ExecCtx) => String(ctx.payload["outcome"]) === ${j(want)},`);
      } else if (emit.when) {
        throw new CodegenError(`${cmd.id}: unknown when clause "${emit.when}"`);
      } else {
        L.push(`        when: null,`);
      }
      L.push(`      },`);
    }
    L.push(`    ],`);
  }

  L.push(`  };`);
  L.push(`},`);
  return L.join("\n");
}

// ---------------------------------------------------------------- projections.ts

function genProjections(reg: Registry): string {
  const reduces: string[] = [];
  const initials: Record<string, Record<string, unknown>> = {};
  const kinds: Record<string, string> = {};
  for (const p of reg.projections) {
    kinds[p.id] = p.kind;
    if (p.kind !== "aggregate" || !p.updates) continue;
    const state: Record<string, unknown> = {};
    const byEvent = new Map<string, string[]>();
    for (const u of p.updates) {
      if (!(u.field in state)) {
        state[u.field] = u.op === "push" ? [] : u.op === "set" ? null : 0;
      }
      const lines = byEvent.get(u.event) ?? [];
      if (u.op === "inc") lines.push(`state[${j(u.field)}] = Number(state[${j(u.field)}]) + 1;`);
      else if (u.op === "sum") lines.push(`state[${j(u.field)}] = Number(state[${j(u.field)}]) + Number(ev.payload[${j(u.from!)}]);`);
      else if (u.op === "sub") lines.push(`state[${j(u.field)}] = Number(state[${j(u.field)}]) - Number(ev.payload[${j(u.from!)}]);`);
      else if (u.op === "set") lines.push(`state[${j(u.field)}] = ev.payload[${j(u.from!)}];`);
      else if (u.op === "push") lines.push(`state[${j(u.field)}] = [...(state[${j(u.field)}] as unknown[] ?? []), ev.payload[${j(u.from!)}]];`);
      byEvent.set(u.event, lines);
    }
    initials[p.id] = state;
    const cases = [...byEvent.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([ev, ls]) => `      case ${j(ev)}:\n        ${ls.join("\n        ")}\n        break;`)
      .join("\n");
    reduces.push(
      `  ${j(p.id)}: function (state, ev) {\n    switch (ev.type) {\n${cases}\n    }\n  },`,
    );
  }
  return (
    header(reg.corpusHash, "projections.ts") +
    [
      "export interface ProjectionEvent { seq: number; ts: string; type: string; entityId: string; actor: string; payload: Record<string, unknown>; }",
      "",
      "export const projectionReduces: Record<string, (state: Record<string, unknown>, ev: ProjectionEvent) => void> = {",
      reduces.join("\n"),
      "};",
      "",
      "export const projectionInitials: Record<string, Record<string, unknown>> = " + stableStringify(initials) + ";",
      "",
      "export const projectionKinds: Record<string, string> = " + stableStringify(kinds) + ";",
      "",
    ].join("\n")
  );
}

// ---------------------------------------------------------------- main

function header(corpusHash: string, artifact: string): string {
  return [
    "// ==============================================================================",
    "// Generated by the SOVR protocol compiler — DO NOT EDIT.",
    `// Artifact: ${artifact}`,
    `// Source of truth: protocol corpus (hash ${corpusHash})`,
    "// All references resolved at compile time; the runtime executes this output",
    "// without interpreting protocol content.",
    "// ==============================================================================",
    "",
  ].join("\n");
}

export function generateModules(reg: Registry): Record<string, string> {
  const dataFields = machineDataFields(reg);

  // validate every command's expressions up front (fail closed)
  for (const cmd of Object.values(reg.commands)) {
    genCommandHandler(reg, cmd, dataFields); // throws CodegenError on any unresolved reference
  }

  const handlers: string[] = [];
  for (const cmd of Object.values(reg.commands)) {
    handlers.push(genCommandHandler(reg, cmd, dataFields));
  }

  const commandHandlersTs =
    header(reg.corpusHash, "command-handlers.ts") +
    "import { sha256Hex, stableStringify, toAddress, addressOf } from \"./helpers.ts\";\n" +
    "import type { ExecCtx, CommandHandler } from \"./helpers.ts\";\n\n" +
    "export const commandHandlers: Record<string, (ctx: ExecCtx) => CommandHandler> = {\n" +
    handlers.join("\n") +
    "\n};\n";

  return {
    "helpers.ts": header(reg.corpusHash, "helpers.ts") + genHelpers(),
    "transitions.ts": genTransitions(reg),
    "command-handlers.ts": commandHandlersTs,
    "projections.ts": genProjections(reg),
  };
}

export { machineDataFields };
