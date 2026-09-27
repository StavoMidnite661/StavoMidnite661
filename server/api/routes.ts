import express from "express";
import path from "path";
import fs from "fs";
import { runtime } from "../engine/runtime";
import { PROTOCOL_DIR } from "../engine/corpus";

const r = express.Router();

function send(res: express.Response, data: unknown, status = 200) {
  res.status(status).json(data);
}

function fail(res: express.Response, msg: string, status = 400) {
  res.status(status).json({ ok: false, error: msg });
}

// ------------------------------------------------ health / overview
r.get("/health", (_req, res) => {
  send(res, { ok: true, service: "sovr-empire", time: new Date().toISOString() });
});

r.get("/overview", (_req, res) => {
  send(res, { ok: true, data: runtime.overview() });
});

// ------------------------------------------------ protocol corpus (compiled view)
r.get("/protocol", (_req, res) => {
  const reg = runtime.registry;
  send(res, {
    ok: true,
    data: {
      protocol: reg.protocol,
      domains: reg.domains,
      counts: {
        identities: Object.keys(reg.identities).length,
        commands: Object.keys(reg.commands).length,
        events: Object.keys(reg.events).length,
        machines: Object.keys(reg.machines).length,
        capabilities: Object.keys(reg.capabilities).length,
        gates: Object.keys(reg.gates).length,
        projections: reg.projections.length,
        scenarios: reg.scenarios.length,
      },
      corpusHash: reg.corpusHash,
      buildIdentity: reg.buildIdentity,
    },
  });
});

// NOTE: the yaml route must be declared before /protocol/:kind,
// otherwise ":kind" swallows the "yaml" segment.
r.get("/protocol/yaml/:file", (req, res) => {
  const f = path.basename(req.params.file);
  if (!f.endsWith(".yaml")) return fail(res, "only corpus yaml files are served", 403);
  const p = path.join(PROTOCOL_DIR, f);
  if (!fs.existsSync(p)) return fail(res, "not found", 404);
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.send(fs.readFileSync(p, "utf8"));
});

r.get("/protocol/:kind", (req, res) => {
  const reg = runtime.registry;
  const kind = req.params.kind;
  const map: Record<string, unknown> = {
    identities: reg.identities,
    commands: reg.commands,
    events: reg.events,
    machines: reg.machines,
    capabilities: reg.capabilities,
    gates: reg.gates,
    projections: reg.projections,
    scenarios: reg.scenarios,
  };
  if (!(kind in map)) return fail(res, `unknown kind "${kind}"`, 404);
  send(res, { ok: true, data: map[kind] });
});

// ------------------------------------------------ compiler
r.post("/compile", (req, res) => {
  const fault = req.body?.fault;
  if (fault && !["unknown_event", "missing_initial", "unknown_capability"].includes(fault)) {
    return fail(res, "unknown fault type");
  }
  try {
    const result = runtime.compile(fault);
    send(res, { ok: true, data: { ...result, replacedAuthority: result.ok && !fault } });
  } catch (e) {
    fail(res, e instanceof Error ? e.message : String(e), 500);
  }
});

r.post("/compile/determinism", (_req, res) => {
  try {
    const a = runtime.compile();
    const b = runtime.compile();
    const compare = (x: typeof a) =>
      Object.keys(x.artifacts ?? {}).sort().map((k) => k + ":" + (x.artifacts as any)[k]);
    const identical = JSON.stringify(compare(a)) === JSON.stringify(compare(b));
    send(res, {
      ok: true,
      data: {
        identical,
        identityA: a.buildIdentity,
        identityB: b.buildIdentity,
        sameIdentity: a.buildIdentity === b.buildIdentity,
        artifacts: a.artifactInfo,
        generated: a.generatedInfo,
        durationMs: a.durationMs,
      },
    });
  } catch (e) {
    fail(res, e instanceof Error ? e.message : String(e), 500);
  }
});

r.get("/registry/:file", (req, res) => {
  const f = path.basename(req.params.file);
  const p = path.join(__dirname, "..", "data", "artifacts", f);
  if (!fs.existsSync(p)) return fail(res, "artifact not found", 404);
  res.setHeader("content-type", "application/json");
  res.send(fs.readFileSync(p, "utf8"));
});

r.get("/generated/:file", (req, res) => {
  const f = path.basename(req.params.file);
  if (!f.endsWith(".ts")) return fail(res, "only generated ts modules are served", 403);
  const p = path.join(__dirname, "..", "data", "generated", f);
  if (!fs.existsSync(p)) return fail(res, "module not found", 404);
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.send(fs.readFileSync(p, "utf8"));
});

// ------------------------------------------------ kernel
r.get("/kernel/commands", (_req, res) => {
  const reg = runtime.registry;
  const out = Object.values(reg.commands).map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    description: c.description,
    capabilities: c.capabilities,
    payload: c.payload,
    emits: c.emits.map((e) => e.event),
    gates: (c.gates ?? []).map((g) => g.id),
    ledger: c.ledger?.kind ?? null,
  }));
  send(res, { ok: true, data: out });
});

r.post("/kernel/command", (req, res) => {
  const { command, actor, payload } = req.body ?? {};
  if (!command || !actor || typeof payload !== "object") return fail(res, "command, actor and payload object required");
  try {
    const receipt = runtime.kernel.execute({ command, actor, payload });
    send(res, { ok: true, data: receipt });
  } catch (e) {
    fail(res, e instanceof Error ? e.message : String(e), 500);
  }
});

// ------------------------------------------------ state
r.get("/state", (_req, res) => {
  const reg = runtime.registry;
  send(res, {
    ok: true,
    data: {
      instances: runtime.state.all(),
      machines: reg.machines,
      counts: runtime.state.countsByMachine(),
    },
  });
});

// ------------------------------------------------ events
r.get("/events", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const before = req.query.before !== undefined ? Number(req.query.before) : undefined;
  send(res, { ok: true, data: { events: runtime.events.list(limit, before), total: runtime.events.length } });
});

r.post("/events/verify", (_req, res) => {
  send(res, { ok: true, data: runtime.events.verify() });
});

r.post("/events/replay", (_req, res) => {
  const verify = runtime.replayVerify();
  const rebuilt = runtime.replayFromEventLog();
  send(res, { ok: true, data: { ...verify, rebuilt } });
});

r.get("/events/export", (_req, res) => {
  res.setHeader("content-type", "application/x-ndjson");
  res.setHeader("content-disposition", 'attachment; filename="sovr-events.jsonl"');
  res.send(runtime.events.export());
});

// ------------------------------------------------ projections
r.get("/projections", (_req, res) => {
  send(res, { ok: true, data: runtime.projections.withCensus(runtime.state.countsByMachine()) });
});

// ------------------------------------------------ ledger
r.get("/ledger", (_req, res) => {
  send(res, {
    ok: true,
    data: {
      accounts: runtime.ledger.listAccounts(),
      transfers: runtime.ledger.transfers.slice(-100).reverse(),
      verify: runtime.ledger.verify(),
      genesisSupply: runtime.ledger.genesisSupply,
    },
  });
});

// ------------------------------------------------ authz
r.get("/authz", (_req, res) => {
  const reg = runtime.registry;
  const snap = runtime.authz.snapshot();
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const cap of Object.keys(reg.capabilities).sort()) {
    matrix[cap] = {};
    for (const id of snap.identities.map((i) => i.id).sort()) {
      matrix[cap][id] = runtime.authz.has(id, cap);
    }
  }
  send(res, {
    ok: true,
    data: { identities: snap.identities, grants: snap.grants, denials: runtime.authz.denials.slice(-50).reverse(), matrix, capabilities: reg.capabilities },
  });
});

// Authorization mutations flow through the kernel like every other command.
// The command to dispatch is resolved generically from the compiled
// authority: the command whose compiled authz-effect matches the requested
// kind. No command names are hard-coded in the API.
function authzCommand(kind: "grant" | "revoke"): string | undefined {
  return Object.values(runtime.registry.commands).find((c) => c.authz?.kind === kind)?.id;
}

r.post("/authz/grant", (req, res) => {
  const { actor, target, capability } = req.body ?? {};
  if (!actor || !target || !capability) return fail(res, "actor, target and capability required");
  const command = authzCommand("grant");
  if (!command) return fail(res, "no grant authority command in compiled registry", 500);
  const receipt = runtime.kernel.execute({ command, actor: String(actor), payload: { targetIdentity: String(target), capability: String(capability) } });
  send(res, { ok: receipt.ok, data: { receipt, snapshot: runtime.authz.snapshot() } });
});

r.post("/authz/revoke", (req, res) => {
  const { actor, target, capability } = req.body ?? {};
  if (!actor || !target || !capability) return fail(res, "actor, target and capability required");
  const command = authzCommand("revoke");
  if (!command) return fail(res, "no revoke authority command in compiled registry", 500);
  const receipt = runtime.kernel.execute({ command, actor: String(actor), payload: { targetIdentity: String(target), capability: String(capability) } });
  send(res, { ok: receipt.ok, data: { receipt, snapshot: runtime.authz.snapshot() } });
});

// ------------------------------------------------ web3
r.get("/web3/keys", (_req, res) => {
  send(res, {
    ok: true,
    data: runtime.web3.keys.map((k) => ({ id: k.id, name: k.name, address: k.address, pub: k.pub, privMasked: k.priv.slice(0, 8) + "…" + k.priv.slice(-4), createdAt: k.createdAt })),
    evidenceHash: runtime.web3.evidenceHash(),
  });
});

r.post("/web3/keys/:id/reveal", (req, res) => {
  const k = runtime.web3.get(req.params.id);
  if (!k) return fail(res, "key not found", 404);
  send(res, { ok: true, data: { id: k.id, priv: k.priv } });
});

r.post("/web3/keys", (req, res) => {
  const name = String(req.body?.name ?? "wallet-" + (runtime.web3.keys.length + 1));
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) + "-" + Math.random().toString(36).slice(2, 6);
  try {
    const key = runtime.web3.createKey(id, name);
    send(res, { ok: true, data: { id: key.id, name: key.name, address: key.address, pub: key.pub, createdAt: key.createdAt } });
  } catch (e) {
    fail(res, e instanceof Error ? e.message : String(e));
  }
});

r.post("/web3/sign", (req, res) => {
  const { keyId, orderId, payer, payee, amount } = req.body ?? {};
  if (!keyId || !orderId || !payer || !payee || amount === undefined) return fail(res, "keyId, orderId, payer, payee, amount required");
  try {
    const signed = runtime.web3.sign(String(keyId), { orderId: String(orderId), payer: String(payer), payee: String(payee), amount: Number(amount) });
    send(res, { ok: true, data: signed });
  } catch (e) {
    fail(res, e instanceof Error ? e.message : String(e));
  }
});

r.post("/web3/verify", (req, res) => {
  const out = runtime.web3.verify(req.body ?? {});
  send(res, { ok: true, data: out });
});

// ------------------------------------------------ simulations
r.get("/simulations", (_req, res) => {
  send(res, { ok: true, data: { scenarios: runtime.registry.scenarios, reports: runtime.sims.reports.slice(0, 25) } });
});

r.post("/simulations/run", (req, res) => {
  const id = String(req.body?.id ?? "");
  try {
    const report = runtime.sims.run(id);
    send(res, { ok: true, data: report });
  } catch (e) {
    fail(res, e instanceof Error ? e.message : String(e));
  }
});

// ------------------------------------------------ system
r.post("/reset", (_req, res) => {
  runtime.reset();
  send(res, { ok: true, data: { reset: true, at: new Date().toISOString() } });
});

// ------------------------------------------------ live stream (SSE)
r.get("/stream", (req, res) => {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.write("event: hello\ndata: {\"kind\":\"hello\"}\n\n");
  const listener = (msg: { kind: string; [k: string]: unknown }) => {
    res.write(`event: ${msg.kind}\ndata: ${JSON.stringify(msg)}\n\n`);
  };
  runtime.listeners.add(listener);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    runtime.listeners.delete(listener);
  });
});

export default r;
