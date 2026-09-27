"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateRegistry = void 0;
const hash_1 = require("../crypto/hash");
/**
 * Live state of protocol entities, advanced strictly by events via the
 * compiled state machines. A fresh instance of this class plus replay of
 * the event log must reproduce the exact same snapshot.
 */
class StateRegistry {
    instances = new Map();
    create(machine, id, data) {
        // createdAt is stamped by the first event that references the instance
        // (kernel and replay both derive it from the event log, so snapshots
        // are deterministic).
        const inst = {
            id,
            machine,
            state: "",
            data,
            createdAt: "",
        };
        this.instances.set(id, inst);
        return inst;
    }
    get(id) {
        return this.instances.get(id);
    }
    setInitial(id, machine) {
        const inst = this.instances.get(id);
        if (inst)
            inst.state = machine.initial;
    }
    /**
     * Apply an event to an instance. Returns true if a transition occurred.
     * Fail-closed: if the machine defines the event but the current state is
     * not a legal source, the transition is refused (returns false).
     */
    /**
     * Apply an event to an instance. A machine may declare several entries
     * for one event (a create self-loop plus an activation); the LAST entry
     * matching the current state wins. Fail-closed: no matching entry means
     * the transition is refused.
     */
    apply(machine, eventId, inst) {
        const matches = machine.transitions.filter((t) => t.event === eventId && (t.from ?? machine.states).includes(inst.state));
        if (matches.length === 0)
            return false;
        inst.state = matches[matches.length - 1].to;
        return true;
    }
    countsByMachine() {
        const out = {};
        for (const inst of this.instances.values()) {
            out[inst.machine] = (out[inst.machine] ?? 0) + 1;
        }
        return out;
    }
    all() {
        return [...this.instances.values()];
    }
    /** Drop all instances (in-place, so existing references stay valid). */
    clear() {
        this.instances.clear();
    }
    snapshot() {
        const rows = [...this.instances.entries()]
            .map(([id, inst]) => [id, { machine: inst.machine, state: inst.state, data: inst.data, createdAt: inst.createdAt }])
            .sort((a, b) => (a[0] < b[0] ? -1 : 1));
        return (0, hash_1.stableStringify)(rows);
    }
}
exports.StateRegistry = StateRegistry;
