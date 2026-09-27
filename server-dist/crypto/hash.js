"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Hex = sha256Hex;
exports.stableStringify = stableStringify;
exports.shortHash = shortHash;
exports.toAddress = toAddress;
const crypto_1 = require("crypto");
/** SHA-256 hex digest of a string or buffer. */
function sha256Hex(input) {
    return (0, crypto_1.createHash)("sha256").update(input).digest("hex");
}
/**
 * Deterministic JSON serialization: object keys sorted recursively,
 * undefined dropped, arrays preserved. This is the canonical form used
 * for build identity, event hashing and replay comparison.
 */
function stableStringify(value) {
    const walk = (v) => {
        if (v === undefined)
            return null;
        if (Array.isArray(v))
            return v.map(walk);
        if (v !== null && typeof v === "object") {
            const out = {};
            const keys = Object.keys(v).sort();
            for (const k of keys) {
                const val = v[k];
                if (val !== undefined)
                    out[k] = walk(val);
            }
            return out;
        }
        return v;
    };
    return JSON.stringify(walk(value === undefined ? null : value));
}
/** First n chars of a hex string. */
function shortHash(hex, chars = 10) {
    if (!hex || hex.length <= chars * 2)
        return hex;
    return `${hex.slice(0, chars)}…${hex.slice(-chars)}`;
}
/** Deterministic 20-byte hex "address" derived from a name (demo mapping). */
function toAddress(name) {
    return "0x" + sha256Hex("sovr:addr:" + name).slice(0, 40);
}
