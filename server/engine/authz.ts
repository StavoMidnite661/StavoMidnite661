import fs from "fs";
import path from "path";
import type { GrantDef, IdentityDef } from "./types";

export interface AuthzError {
  code: string;
  message: string;
}

/**
 * Production authorization is fail-closed:
 *  - unknown identities hold no capabilities
 *  - granting requires the authz:grant capability
 *  - the meta capability itself can only be handled by the constitutional identity
 *  - constitutional identities are immutable
 *
 * The identity roster and genesis grants come from the compiled registry
 * (identities.yaml corpus) — this class holds no protocol content.
 */
export class Authz {
  identities = new Map<string, IdentityDef & { constitutional?: boolean }>();
  grants: GrantDef[] = [];
  denials: { ts: string; identity: string; command: string; missing: string[] }[] = [];
  private file: string;

  private corpus: Record<string, { id: string; name: string; kind: string; constitutional?: boolean; capabilities: string[] }>;

  constructor(file: string, corpus: Record<string, { id: string; name: string; kind: string; constitutional?: boolean; capabilities: string[] }>) {
    this.file = file;
    this.corpus = corpus;
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const i of raw.identities) this.identities.set(i.id, i);
      this.grants = raw.grants;
      this.denials = raw.denials ?? [];
    } else {
      this.bootstrap(corpus);
      this.persist();
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  /** The constitutionally authoritative identity (if the corpus defines one). */
  private constitutional(): string | undefined {
    for (const [id, def] of this.identities) if (def.constitutional) return id;
    return undefined;
  }

  /** Materialize the roster + genesis grants from compiled authority. */
  private bootstrap(corpus: Record<string, { id: string; name: string; kind: string; constitutional?: boolean; capabilities: string[] }>): void {
    for (const def of Object.values(corpus)) {
      this.identities.set(def.id, {
        id: def.id,
        name: def.name,
        kind: def.kind,
        constitutional: def.constitutional,
        createdAt: this.now(),
      });
      for (const cap of def.capabilities) {
        this.grants.push({ identity: def.id, capability: cap, grantedBy: "system", at: this.now() });
      }
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify(
        { identities: [...this.identities.values()], grants: this.grants, denials: this.denials.slice(-200) },
        null,
        2,
      ),
    );
  }

  listIdentities(): IdentityDef[] {
    return [...this.identities.values()];
  }

  hasIdentity(id: string): boolean {
    return this.identities.has(id);
  }

  /** Fail-closed: unknown identity => no capabilities at all. */
  has(identityId: string, capability: string): boolean {
    const def = this.identities.get(identityId);
    if (!def) return false;
    if (def.constitutional) return true; // constitutional authority holds all capabilities
    return this.grants.some((g) => g.identity === identityId && g.capability === capability);
  }

  capsOf(identityId: string): string[] {
    const def = this.identities.get(identityId);
    if (def?.constitutional) return ["*"];
    return this.grants.filter((g) => g.identity === identityId).map((g) => g.capability);
  }

  missing(identityId: string, required: string[]): string[] {
    const def = this.identities.get(identityId);
    if (def?.constitutional) return [];
    return required.filter((c) => !this.has(identityId, c));
  }

  /**
   * Record an authorization effect that has already passed the kernel's
   * authority pipeline (compiled authz-effects module). No re-checks:
   * the kernel is the boundary that authorizes.
   */
  apply(kind: "grant" | "revoke", actorId: string, targetId: string, capability: string): void {
    // constitutional authority is immutable at the mechanism level
    if (this.identities.get(targetId)?.constitutional) return;
    if (kind === "grant") {
      if (!this.grants.some((g) => g.identity === targetId && g.capability === capability)) {
        this.grants.push({ identity: targetId, capability, grantedBy: actorId, at: this.now() });
      }
    } else {
      const idx = this.grants.findIndex((g) => g.identity === targetId && g.capability === capability);
      if (idx >= 0) this.grants.splice(idx, 1);
    }
    this.persist();
  }

  recordDenial(identity: string, command: string, missing: string[]): void {
    this.denials.push({ ts: this.now(), identity, command, missing });
    if (this.denials.length > 500) this.denials = this.denials.slice(-500);
  }

  snapshot(): { identities: IdentityDef[]; grants: GrantDef[]; denials: number } {
    return {
      identities: [...this.identities.values()],
      grants: [...this.grants],
      denials: this.denials.length,
    };
  }

  destroy(): void {
    this.identities.clear();
    this.grants = [];
    this.denials = [];
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    this.bootstrap(this.corpus);
    this.persist();
  }
}
