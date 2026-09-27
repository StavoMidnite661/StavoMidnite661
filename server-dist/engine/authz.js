"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Authz = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
class Authz {
    identities = new Map();
    grants = [];
    denials = [];
    file;
    corpus;
    constructor(file, corpus) {
        this.file = file;
        this.corpus = corpus;
        if (fs_1.default.existsSync(file)) {
            const raw = JSON.parse(fs_1.default.readFileSync(file, "utf8"));
            for (const i of raw.identities)
                this.identities.set(i.id, i);
            this.grants = raw.grants;
            this.denials = raw.denials ?? [];
        }
        else {
            this.bootstrap(corpus);
            this.persist();
        }
    }
    now() {
        return new Date().toISOString();
    }
    /** The constitutionally authoritative identity (if the corpus defines one). */
    constitutional() {
        for (const [id, def] of this.identities)
            if (def.constitutional)
                return id;
        return undefined;
    }
    /** Materialize the roster + genesis grants from compiled authority. */
    bootstrap(corpus) {
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
    persist() {
        fs_1.default.mkdirSync(path_1.default.dirname(this.file), { recursive: true });
        fs_1.default.writeFileSync(this.file, JSON.stringify({ identities: [...this.identities.values()], grants: this.grants, denials: this.denials.slice(-200) }, null, 2));
    }
    listIdentities() {
        return [...this.identities.values()];
    }
    hasIdentity(id) {
        return this.identities.has(id);
    }
    /** Fail-closed: unknown identity => no capabilities at all. */
    has(identityId, capability) {
        const def = this.identities.get(identityId);
        if (!def)
            return false;
        if (def.constitutional)
            return true; // constitutional authority holds all capabilities
        return this.grants.some((g) => g.identity === identityId && g.capability === capability);
    }
    capsOf(identityId) {
        const def = this.identities.get(identityId);
        if (def?.constitutional)
            return ["*"];
        return this.grants.filter((g) => g.identity === identityId).map((g) => g.capability);
    }
    missing(identityId, required) {
        const def = this.identities.get(identityId);
        if (def?.constitutional)
            return [];
        return required.filter((c) => !this.has(identityId, c));
    }
    /**
     * Record an authorization effect that has already passed the kernel's
     * authority pipeline (compiled authz-effects module). No re-checks:
     * the kernel is the boundary that authorizes.
     */
    apply(kind, actorId, targetId, capability) {
        // constitutional authority is immutable at the mechanism level
        if (this.identities.get(targetId)?.constitutional)
            return;
        if (kind === "grant") {
            if (!this.grants.some((g) => g.identity === targetId && g.capability === capability)) {
                this.grants.push({ identity: targetId, capability, grantedBy: actorId, at: this.now() });
            }
        }
        else {
            const idx = this.grants.findIndex((g) => g.identity === targetId && g.capability === capability);
            if (idx >= 0)
                this.grants.splice(idx, 1);
        }
        this.persist();
    }
    recordDenial(identity, command, missing) {
        this.denials.push({ ts: this.now(), identity, command, missing });
        if (this.denials.length > 500)
            this.denials = this.denials.slice(-500);
    }
    snapshot() {
        return {
            identities: [...this.identities.values()],
            grants: [...this.grants],
            denials: this.denials.length,
        };
    }
    destroy() {
        this.identities.clear();
        this.grants = [];
        this.denials = [];
        if (fs_1.default.existsSync(this.file))
            fs_1.default.unlinkSync(this.file);
        this.bootstrap(this.corpus);
        this.persist();
    }
}
exports.Authz = Authz;
