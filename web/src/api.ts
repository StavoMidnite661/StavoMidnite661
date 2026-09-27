// Thin API client for the SOVR kernel.

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* keep status message */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  overview: () => request<{ ok: true; data: import("./types").Overview }>("/overview"),
  protocol: () => request<{ ok: true; data: any }>("/protocol"),
  protocolKind: (kind: string) => request<{ ok: true; data: any }>(`/protocol/${kind}`),
  protocolYaml: async (file: string) => {
    const res = await fetch(`/api/protocol/yaml/${file}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.text();
  },
  compile: (fault?: string) =>
    request<{ ok: true; data: import("./types").CompileResult }>("/compile", {
      method: "POST",
      body: JSON.stringify(fault ? { fault } : {}),
    }),
  compileDeterminism: () =>
    request<{ ok: true; data: any }>("/compile/determinism", { method: "POST" }),
  registry: (file: string) => request<any>(`/registry/${file}`),
  generated: async (file: string) => {
    const res = await fetch(`/api/generated/${file}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.text();
  },
  commands: () => request<{ ok: true; data: import("./types").CommandDef[] }>("/kernel/commands"),
  executeCommand: (command: string, actor: string, payload: Record<string, unknown>) =>
    request<{ ok: true; data: import("./types").Receipt }>("/kernel/command", {
      method: "POST",
      body: JSON.stringify({ command, actor, payload }),
    }),
  state: () =>
    request<{
      ok: true;
      data: { instances: import("./types").Instance[]; machines: Record<string, import("./types").MachineDef>; counts: Record<string, number> };
    }>("/state"),
  events: (limit = 100) =>
    request<{ ok: true; data: { events: import("./types").StoredEvent[]; total: number } }>(`/events?limit=${limit}`),
  eventsVerify: () => request<{ ok: true; data: { ok: boolean; checked: number; brokenAt?: number } }>("/events/verify", { method: "POST" }),
  eventsReplay: () =>
    request<{ ok: true; data: { ok: boolean; events: number; live: string; replayed: string; rebuilt: { replayed: number } } }>(
      "/events/replay",
      { method: "POST" },
    ),
  projections: () => request<{ ok: true; data: Record<string, any> }>("/projections"),
  ledger: () =>
    request<{
      ok: true;
      data: {
        accounts: import("./types").LedgerAccount[];
        transfers: import("./types").LedgerTransfer[];
        verify: { doubleEntry: boolean; balancesMatch: boolean; supplyInvariant: boolean; totalBalance: number; accounts: number; transfers: number };
        genesisSupply: number;
      };
    }>("/ledger"),
  authz: () => request<{ ok: true; data: import("./types").AuthzData }>("/authz"),
  authzGrant: (actor: string, target: string, capability: string) =>
    request<{ ok: boolean; data: { receipt: import("./types").Receipt; snapshot: any } }>("/authz/grant", {
      method: "POST",
      body: JSON.stringify({ actor, target, capability }),
    }),
  authzRevoke: (actor: string, target: string, capability: string) =>
    request<{ ok: boolean; data: { receipt: import("./types").Receipt; snapshot: any } }>("/authz/revoke", {
      method: "POST",
      body: JSON.stringify({ actor, target, capability }),
    }),
  web3Keys: () => request<{ ok: true; data: import("./types").Web3Key[]; evidenceHash: string }>("/web3/keys"),
  web3CreateKey: (name: string) =>
    request<{ ok: true; data: import("./types").Web3Key }>("/web3/keys", { method: "POST", body: JSON.stringify({ name }) }),
  web3Reveal: (id: string) =>
    request<{ ok: true; data: { id: string; priv: string } }>(`/web3/keys/${id}/reveal`, { method: "POST" }),
  web3Sign: (keyId: string, orderId: string, payer: string, payee: string, amount: number) =>
    request<{ ok: true; data: any }>("/web3/sign", {
      method: "POST",
      body: JSON.stringify({ keyId, orderId, payer, payee, amount }),
    }),
  web3Verify: (body: Record<string, unknown>) =>
    request<{ ok: true; data: { ok: boolean; reason?: string; recovered?: string; digest?: string } }>("/web3/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  simulations: () =>
    request<{ ok: true; data: { scenarios: import("./types").ScenarioDef[]; reports: import("./types").ScenarioReport[] } }>(
      "/simulations",
    ),
  simulationRun: (id: string) =>
    request<{ ok: true; data: import("./types").ScenarioReport }>("/simulations/run", { method: "POST", body: JSON.stringify({ id }) }),
  reset: () => request<{ ok: true; data: { reset: boolean; at: string } }>("/reset", { method: "POST" }),
  eventsExportUrl: () => "/api/events/export",
};

/** Server-sent events from the kernel. Returns a disconnect function. */
export function subscribe(handler: (msg: { kind: string; [k: string]: unknown }) => void): () => void {
  const es = new EventSource("/api/stream");
  const kinds = ["hello", "event", "receipt", "reset"];
  for (const k of kinds) {
    es.addEventListener(k, (e: MessageEvent) => {
      try {
        handler({ kind: k, ...JSON.parse(e.data) });
      } catch {
        /* ignore malformed frames */
      }
    });
  }
  const err = () => {
    /* the console keeps working via polling; SSE is progressive enhancement */
  };
  es.onerror = err;
  return () => es.close();
}

export function fmtAmount(v: unknown, digits = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "—");
  // μSOVR → SOVR (base 1e6)
  const sovr = n / 1_000_000;
  if (sovr !== 0 && Math.abs(sovr) < 0.01) return `${n.toLocaleString()} μ`;
  return `${sovr.toLocaleString(undefined, { maximumFractionDigits: digits })} SOVR`;
}

export function shortHash(h: string, n = 10): string {
  if (!h) return "—";
  return h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;
}

export function timeAgo(ts: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString();
}
