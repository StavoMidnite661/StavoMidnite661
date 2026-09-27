"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hash_1 = require("../crypto/hash");
/**
 * Append-only, hash-chained event store. Every event carries the hash of
 * its predecessor, so the log is tamper-evident: any rewrite breaks the
 * chain and `verify()` finds it. State is always reconstructable by replay.
 */
class EventStore {
    events = [];
    file;
    onAppend;
    constructor(file, genesisPayload) {
        this.file = file;
        if (fs_1.default.existsSync(file)) {
            const raw = fs_1.default.readFileSync(file, "utf8").split("\n").filter(Boolean);
            this.events = raw.map((l) => JSON.parse(l));
        }
        if (this.events.length === 0) {
            const ev = {
                seq: 0,
                ts: new Date().toISOString(),
                type: "SystemGenesis",
                entityId: "kernel",
                actor: "system",
                payload: genesisPayload,
                affected: [],
                prevHash: "0".repeat(64),
                hash: "",
            };
            ev.hash = this.computeHash(ev);
            this.events.push(ev);
            fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
            fs_1.default.writeFileSync(file, JSON.stringify(ev) + "\n");
        }
    }
    computeHash(ev) {
        const body = (0, hash_1.stableStringify)({
            seq: ev.seq,
            ts: ev.ts,
            type: ev.type,
            entityId: ev.entityId,
            actor: ev.actor,
            payload: ev.payload,
            affected: ev.affected ?? [],
            prevHash: ev.prevHash,
        });
        return (0, hash_1.sha256Hex)(body);
    }
    get length() {
        return this.events.length;
    }
    list(limit = 100, beforeSeq) {
        let evs = this.events;
        if (beforeSeq !== undefined)
            evs = evs.filter((e) => e.seq < beforeSeq);
        return evs.slice(-limit).reverse();
    }
    all() {
        return [...this.events];
    }
    last() {
        return this.events[this.events.length - 1];
    }
    append(input) {
        const prev = this.last();
        const ev = {
            seq: prev ? prev.seq + 1 : 0,
            ts: new Date().toISOString(),
            type: input.type,
            entityId: input.entityId,
            actor: input.actor,
            payload: input.payload,
            affected: input.affected ?? [],
            prevHash: prev ? prev.hash : "0".repeat(64),
        };
        const full = { ...ev, hash: this.computeHash(ev) };
        this.events.push(full);
        fs_1.default.appendFileSync(this.file, JSON.stringify(full) + "\n");
        this.onAppend?.(full);
        return full;
    }
    /** Recompute the whole chain; detect any tampering. */
    verify() {
        for (let i = 0; i < this.events.length; i++) {
            const ev = this.events[i];
            const { hash, ...rest } = ev;
            if (this.computeHash(rest) !== hash)
                return { ok: false, brokenAt: ev.seq, checked: i };
            if (i > 0 && ev.prevHash !== this.events[i - 1].hash) {
                return { ok: false, brokenAt: ev.seq, checked: i };
            }
        }
        return { ok: true, checked: this.events.length };
    }
    export() {
        return this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    }
    destroy() {
        this.events = [];
        if (fs_1.default.existsSync(this.file))
            fs_1.default.unlinkSync(this.file);
    }
}
exports.EventStore = EventStore;
