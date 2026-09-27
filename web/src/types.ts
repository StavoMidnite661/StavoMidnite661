// Shared API types (mirrors the compiled registry / kernel response shapes)

export interface Overview {
  startedAt: string;
  build: {
    identity: string;
    corpusHash: string;
    protocol: string;
    version: string;
    unit: { name: string; base: number };
    compiledAt: string;
    artifacts: number;
    generated: number;
  };
  counts: {
    events: number;
    entities: number;
    transfers: number;
    ledgerAccounts: number;
    grants: number;
    denials: number;
    keys: number;
  };
  integrity: {
    chain: { ok: boolean; checked: number; brokenAt?: number };
    ledger: {
      doubleEntry: boolean;
      balancesMatch: boolean;
      supplyInvariant: boolean;
      totalBalance: number;
      genesisSupply: number;
    };
  };
  supply: { reserve: number; total: number; genesis: number };
  recent: {
    receipts: { id: string; command: string; actor: string; ok: boolean; code: string; ts: string }[];
    events: StoredEvent[];
  };
  countsByMachine: Record<string, number>;
}

export interface StoredEvent {
  seq: number;
  ts: string;
  type: string;
  entityId: string;
  actor: string;
  payload: Record<string, unknown>;
  affected?: { id: string; machine: string }[];
  prevHash: string;
  hash: string;
}

export interface Receipt {
  id: string;
  command: string;
  actor: string;
  ok: boolean;
  code: string;
  reason?: string;
  stages: { name: string; ok: boolean; ms: number; detail?: string }[];
  events: { seq: number; type: string; hash: string }[];
  ledgerOps: Record<string, unknown>[];
  buildIdentity: string;
  ts: string;
  durationMs: number;
}

export interface Instance {
  id: string;
  machine: string;
  state: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface MachineDef {
  id: string;
  entity: string;
  initial: string;
  states: string[];
  terminal: string[];
  transitions: { event: string; from?: string[]; to: string }[];
}

export interface CommandDef {
  id: string;
  name: string;
  domain: string;
  description: string;
  capabilities: string[];
  payload: Record<string, string>;
  emits: { event: string; payload?: Record<string, string>; when?: string }[];
  gates?: { id: string; idFrom?: string; amountFrom?: string; capabilityFrom?: string }[];
  ledger?: { kind: string };
  authz?: { kind: string };
  sourceInstance?: { machine: string; idFrom: string; alias: string };
  preconditions?: { machine: string; idFrom: string; inStates: string[] }[];
  creates?: { machine: string; idFrom: string };
  dataEffects?: unknown[];
  verify?: { kind: string; fields: Record<string, string> };
}

export interface IdentityDef {
  id: string;
  name: string;
  kind: string;
  constitutional?: boolean;
  capabilities: string[];
  createdAt?: string;
}

export interface GateDef {
  id: string;
  name: string;
  rule: string;
  limit?: number;
  threshold?: number;
  refs?: Record<string, string>;
  description: string;
}

export interface CapabilityDef {
  id: string;
  name: string;
  domain: string;
  meta?: boolean;
  description?: string;
}

export interface GrantDef {
  identity: string;
  capability: string;
  grantedBy: string;
  at: string;
}

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  userId: string;
  flags: number;
  createdAt: string;
  opening: number;
  balance?: number;
}

export interface LedgerTransfer {
  id: string;
  ts: string;
  source: string;
  destination: string;
  amount: number;
  memo: string;
  legs: { account: string; type: "debit" | "credit"; amount: number }[];
}

export interface Web3Key {
  id: string;
  name: string;
  address: string;
  pub: string;
  privMasked: string;
  createdAt: string;
}

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  steps: { command?: string; actor?: string; payload?: Record<string, unknown>; verify?: string; expect: string }[];
}

export interface ScenarioStepReport {
  i: number;
  command?: string;
  verify?: string;
  actor?: string;
  expect: string;
  got: string;
  ok: boolean;
  detail?: string;
}

export interface ScenarioReport {
  reportId: string;
  scenarioId: string;
  name: string;
  run: string;
  startedAt: string;
  finishedAt: string;
  steps: ScenarioStepReport[];
  passed: boolean;
  evidence: string;
}

export interface CompileResult {
  ok: boolean;
  logs: { stage: string; level: string; message: string; ms?: number }[];
  errors: { stage: string; message: string }[];
  buildIdentity?: string;
  corpusHash?: string;
  artifacts?: Record<string, string>;
  artifactInfo?: { name: string; bytes: number; sha256: string }[];
  generated?: Record<string, string>;
  generatedInfo?: { name: string; bytes: number; sha256: string }[];
  counts?: Record<string, number>;
  durationMs?: number;
  replacedAuthority?: boolean;
}

export interface AuthzData {
  identities: IdentityDef[];
  grants: GrantDef[];
  denials: number;
  matrix: Record<string, Record<string, boolean>>;
  capabilities: Record<string, CapabilityDef>;
}
