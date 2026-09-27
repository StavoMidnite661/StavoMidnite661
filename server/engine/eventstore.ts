import fs from "fs";
import path from "path";
import { sha256Hex, stableStringify } from "../crypto/hash";
import type { StoredEvent } from "./types";

export interface AppendInput {
  type: string;
  entityId: string;
  actor: string;
  payload: Record<string, unknown>;
  affected?: { id: string; machine: string }[];
}

/**
 * Append-only, hash-chained event store. Every event carries the hash of
 * its predecessor, so the log is tamper-evident: any rewrite breaks the
 * chain and `verify()` finds it. State is always reconstructable by replay.
 */
export class EventStore {
  private events: StoredEvent[] = [];
  private file: string;
  onAppend?: (ev: StoredEvent) => void;

  constructor(file: string, genesisPayload: Record<string, unknown>) {
    this.file = file;
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      this.events = raw.map((l) => JSON.parse(l) as StoredEvent);
    }
    if (this.events.length === 0) {
      const ev: StoredEvent = {
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
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(ev) + "\n");
    }
  }

  private computeHash(ev: Omit<StoredEvent, "hash">): string {
    const body = stableStringify({
      seq: ev.seq,
      ts: ev.ts,
      type: ev.type,
      entityId: ev.entityId,
      actor: ev.actor,
      payload: ev.payload,
      affected: ev.affected ?? [],
      prevHash: ev.prevHash,
    });
    return sha256Hex(body);
  }

  get length(): number {
    return this.events.length;
  }

  list(limit = 100, beforeSeq?: number): StoredEvent[] {
    let evs = this.events;
    if (beforeSeq !== undefined) evs = evs.filter((e) => e.seq < beforeSeq);
    return evs.slice(-limit).reverse();
  }

  all(): StoredEvent[] {
    return [...this.events];
  }

  last(): StoredEvent | undefined {
    return this.events[this.events.length - 1];
  }

  append(input: AppendInput): StoredEvent {
    const prev = this.last();
    const ev: Omit<StoredEvent, "hash"> = {
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
    fs.appendFileSync(this.file, JSON.stringify(full) + "\n");
    this.onAppend?.(full);
    return full;
  }

  /** Recompute the whole chain; detect any tampering. */
  verify(): { ok: boolean; brokenAt?: number; checked: number } {
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      const { hash, ...rest } = ev;
      if (this.computeHash(rest) !== hash) return { ok: false, brokenAt: ev.seq, checked: i };
      if (i > 0 && ev.prevHash !== this.events[i - 1].hash) {
        return { ok: false, brokenAt: ev.seq, checked: i };
      }
    }
    return { ok: true, checked: this.events.length };
  }

  export(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }

  destroy(): void {
    this.events = [];
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
  }
}
