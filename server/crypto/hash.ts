import { createHash } from "crypto";

/** SHA-256 hex digest of a string or buffer. */
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Deterministic JSON serialization: object keys sorted recursively,
 * undefined dropped, arrays preserved. This is the canonical form used
 * for build identity, event hashing and replay comparison.
 */
export function stableStringify(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === undefined) return null;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      const keys = Object.keys(v as Record<string, unknown>).sort();
      for (const k of keys) {
        const val = (v as Record<string, unknown>)[k];
        if (val !== undefined) out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value === undefined ? null : value));
}

/** First n chars of a hex string. */
export function shortHash(hex: string, chars = 10): string {
  if (!hex || hex.length <= chars * 2) return hex;
  return `${hex.slice(0, chars)}…${hex.slice(-chars)}`;
}

/** Deterministic 20-byte hex "address" derived from a name (demo mapping). */
export function toAddress(name: string): string {
  return "0x" + sha256Hex("sovr:addr:" + name).slice(0, 40);
}
