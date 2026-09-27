export type FieldType = "string" | "int" | "amount" | "bool";

export interface DomainDef {
  id: string;
  name: string;
  description: string;
}

export interface CapabilityDef {
  id: string;
  name: string;
  domain: string;
  description: string;
  meta?: boolean;
}

export interface TransitionDef {
  event: string;
  from?: string[];
  to: string;
}

export interface MachineDef {
  id: string;
  entity: string;
  initial: string;
  terminal: string[];
  states: string[];
  transitions: TransitionDef[];
}

export interface EventDef {
  id: string;
  name: string;
  domain: string;
  description: string;
  payload: Record<string, FieldType>;
}

/**
 * Protocol expressions (compiled into generated code):
 *  "@field"            -> command payload field
 *  "<alias>.<path>"    -> source instance data (alias declared on sourceInstance)
 *  "derived.<token>"   -> kernel-computed value (signature, address, transferId,
 *                         attestationId, digest, now)
 *  "actor"             -> executing identity
 *  otherwise           -> literal
 */
export type ProtocolExpression = string;

export interface DataEffectDef {
  machine: string;
  idFrom: string;
  field: string;
  op: "set" | "add" | "sub" | "push";
  value: unknown;
}

export interface LedgerEffectDef {
  kind: "transfer" | "create_account";
  source?: string;
  destination?: string;
  account?: string;
  name?: string;
  amount: string;
  memo?: string;
}

export interface AuthzEffectDef {
  kind: "grant" | "revoke";
  targetFrom: string;
  capabilityFrom: string;
}

export interface GateRef {
  id: string;
  idFrom?: string;
  amountFrom?: string;
  capabilityFrom?: string;
}

export interface EmitDef {
  event: string;
  payload?: Record<string, ProtocolExpression>;
  when?: "outstanding_zero" | "outcome_passed" | "outcome_rejected";
}

export interface VerifySpec {
  kind: "eip712_attestation";
  fields: Record<string, ProtocolExpression>;
}

export interface CommandDef {
  id: string;
  name: string;
  domain: string;
  description: string;
  capabilities: string[];
  payload: Record<string, FieldType>;
  preconditions: { machine: string; idFrom: string; inStates: string[] }[];
  creates?: { machine: string; idFrom: string };
  dataEffects?: DataEffectDef[];
  gates?: GateRef[];
  ledger?: LedgerEffectDef;
  authz?: AuthzEffectDef;
  sourceInstance?: { machine: string; idFrom: string; alias: string };
  verify?: VerifySpec;
  emits: EmitDef[];
}

export type GateRule =
  | "max_amount"
  | "no_self_settlement"
  | "credit_headroom"
  | "liquidation_utilization"
  | "meta_grant_protection"
  | "repay_within_outstanding";

export interface GateRefs {
  machine?: string;
  field?: string;
  limitField?: string;
  outstandingField?: string;
  exposureField?: string;
  amountField?: string;
  metaCapability?: string;
}

export interface GateDef {
  id: string;
  name: string;
  rule: GateRule;
  limit?: number;
  threshold?: number;
  refs?: GateRefs;
  description: string;
}

export interface ProjectionUpdate {
  event: string;
  field: string;
  op: "inc" | "sum" | "sub" | "set" | "push";
  from?: string;
}

export interface ProjectionDef {
  id: string;
  name: string;
  kind: "aggregate" | "census" | "timeline";
  depth?: number;
  description: string;
  updates?: ProjectionUpdate[];
}

export interface ScenarioStep {
  command?: string;
  actor?: string;
  payload?: Record<string, unknown>;
  verify?: "chain" | "replay" | "ledger";
  expect: "ok" | "denied" | "rejected";
}

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  steps: ScenarioStep[];
}

export interface Web3Spec {
  domain: Record<string, unknown>;
  primaryType: string;
  types: Record<string, { name: string; type: string }[]>;
}

export interface LedgerConfig {
  genesisSupply: number;
  reserve: string;
  bootstrapAccounts: { id: string; name: string; opening?: number }[];
}

export interface ProtocolMeta {
  name: string;
  version: string;
  unit: { name: string; base: number };
  ledger?: LedgerConfig;
  web3?: Web3Spec;
}

export interface IdentityCorpusDef {
  id: string;
  name: string;
  kind: string;
  constitutional?: boolean;
  capabilities: string[];
}

export interface Registry {
  protocol: ProtocolMeta;
  domains: DomainDef[];
  identities: Record<string, IdentityCorpusDef>;
  commands: Record<string, CommandDef>;
  events: Record<string, EventDef>;
  machines: Record<string, MachineDef>;
  capabilities: Record<string, CapabilityDef>;
  gates: Record<string, GateDef>;
  projections: ProjectionDef[];
  scenarios: ScenarioDef[];
  corpusHash: string;
  buildIdentity: string;
  compiledAt: string;
}

export interface CorpusFiles {
  files: Record<string, string>;
  data: {
    domains: unknown;
    identities: unknown;
    capabilities: unknown;
    "state-machines": unknown;
    events: unknown;
    commands: unknown;
    governance: unknown;
    projections: unknown;
    scenarios: unknown;
  };
}

export type CompileStage =
  | "corpus-load"
  | "schema-validation"
  | "semantic-validation"
  | "cross-reference"
  | "state-machines"
  | "capabilities"
  | "ir-materialization"
  | "registry-generation"
  | "code-generation"
  | "build-identity"
  | "reproducibility";

export interface CompileLog {
  stage: CompileStage;
  level: "info" | "warn" | "error" | "ok";
  message: string;
  ms?: number;
}

export interface CompileError {
  stage: CompileStage;
  message: string;
}

export interface ArtifactInfo {
  name: string;
  bytes: number;
  sha256: string;
}

export interface CompileResult {
  ok: boolean;
  logs: CompileLog[];
  errors: CompileError[];
  buildIdentity?: string;
  corpusHash?: string;
  artifacts?: Record<string, string>;
  artifactInfo?: ArtifactInfo[];
  generated?: Record<string, string>;
  generatedInfo?: ArtifactInfo[];
  counts?: {
    commands: number;
    events: number;
    machines: number;
    capabilities: number;
    gates: number;
    projections: number;
    scenarios: number;
    domains: number;
  };
  durationMs: number;
}

export interface Instance {
  id: string;
  machine: string;
  state: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AffectedEntity {
  id: string;
  machine: string;
}

export interface StoredEvent {
  seq: number;
  ts: string;
  type: string;
  entityId: string;
  actor: string;
  payload: Record<string, unknown>;
  affected: AffectedEntity[];
  prevHash: string;
  hash: string;
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

export interface LedgerLeg {
  account: string;
  type: "debit" | "credit";
  amount: number;
}

export interface LedgerTransfer {
  id: string;
  ts: string;
  source: string;
  destination: string;
  amount: number;
  memo: string;
  legs: LedgerLeg[];
}

export interface IdentityDef {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
}

export interface GrantDef {
  identity: string;
  capability: string;
  grantedBy: string;
  at: string;
}

export interface Receipt {
  id: string;
  command: string;
  actor: string;
  ok: boolean;
  code:
    | "OK"
    | "COMMAND_UNKNOWN"
    | "ACTOR_UNKNOWN"
    | "AUTH_DENIED"
    | "VALIDATION_FAILED"
    | "GATE_VIOLATION"
    | "STATE_VIOLATION"
    | "WEB3_INVALID"
    | "LEDGER_ERROR";
  reason?: string;
  stages: { name: string; ok: boolean; detail?: string; ms: number }[];
  events: { seq: number; type: string; hash: string }[];
  ledgerOps: Record<string, unknown>[];
  buildIdentity: string;
  ts: string;
  durationMs: number;
}

export interface ScenarioStepReport {
  i: number;
  command?: string;
  actor?: string;
  verify?: string;
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

/** Shape of the compiler-generated modules the kernel executes. */
export interface GeneratedModules {
  transitions: Record<string, Record<string, { from: string[]; to: string }[]>>;
  /** Closed handlers — every protocol reference resolved at compile time. */
  commandHandlers: Record<string, (ctx: any) => any>;
  projectionReduces: Record<string, (state: Record<string, unknown>, ev: any) => void>;
  projectionInitials: Record<string, Record<string, unknown>>;
  projectionKinds: Record<string, string>;
}
