import type { GeneratedModules, ProjectionDef, StoredEvent } from "./types";

/**
 * Projection engine. Aggregate projections are updated exclusively by the
 * compiler-generated reducers; census and timeline projections are derived
 * views maintained by the engine itself.
 */
export class ProjectionEngine {
  data: Record<string, any> = {};

  constructor(private modules: GeneratedModules, private defs: ProjectionDef[]) {
    this.reinit();
  }

  /** Re-initialize projection state in-place (references stay valid). */
  reinit(): void {
    this.data = {};
    for (const p of this.defs) {
      if (p.kind === "aggregate") {
        this.data[p.id] = { ...(this.modules.projectionInitials[p.id] ?? {}) };
      } else if (p.kind === "timeline") {
        this.data[p.id] = [];
      } else {
        this.data[p.id] = {};
      }
    }
  }

  onEvent(ev: StoredEvent): void {
    for (const p of this.defs) {
      if (p.kind === "aggregate") {
        const reduce = this.modules.projectionReduces[p.id];
        if (reduce) reduce(this.data[p.id], ev);
      } else if (p.kind === "timeline") {
        const depth = p.depth ?? 20;
        const arr = this.data[p.id] as any[];
        arr.push({ seq: ev.seq, ts: ev.ts, type: ev.type, entityId: ev.entityId, actor: ev.actor });
        while (arr.length > depth) arr.shift();
      }
    }
  }

  /** Derived census view (updated on read from the live state registry). */
  withCensus(counts: Record<string, number>): Record<string, any> {
    this.data["entity_census"] = { ...counts };
    return this.data;
  }
}
