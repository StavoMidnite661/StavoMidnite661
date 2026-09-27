"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keccak256Str = void 0;
exports.hashStruct = hashStruct;
exports.domainSeparator = domainSeparator;
exports.eip712Digest = eip712Digest;
exports.digestHex = digestHex;
/**
 * EIP-712 typed data hashing (Ethereum), implemented over our Keccak-256.
 * Produces the exact 32-byte domain separator / struct hashes defined by
 * the EIP-712 specification.
 */
const keccak_1 = require("./keccak");
Object.defineProperty(exports, "keccak256Str", { enumerable: true, get: function () { return keccak_1.keccak256Str; } });
/**
 * EIP-712 encodeType: primary type's field list, followed by all dependent
 * struct types in alphabetical order with their field lists.
 */
function encodeType(type, types) {
    const deps = [];
    const visit = (t) => {
        if (!types[t] || deps.includes(t))
            return;
        deps.push(t);
        for (const f of types[t]) {
            const base = f.type.replace(/\[\]$/, "");
            if (types[base])
                visit(base);
        }
    };
    visit(type);
    const rest = deps.filter((d) => d !== type).sort();
    const fieldList = (t) => types[t].map((f) => f.type + " " + f.name).join(",");
    return `${type}(${fieldList(type)})` + rest.map((d) => `${d}(${fieldList(d)})`).join("");
}
function hashType(type, types) {
    return (0, keccak_1.keccak256)(Buffer.from(encodeType(type, types), "utf8"));
}
function encodeField(type, value) {
    if (type === "string")
        return (0, keccak_1.keccak256)(Buffer.from(String(value), "utf8"));
    if (type === "bytes") {
        let hex = String(value);
        if (hex.startsWith("0x"))
            hex = hex.slice(2);
        return (0, keccak_1.keccak256)(Buffer.from(hex, "hex"));
    }
    if (type === "bool")
        return Buffer.from([value ? 1 : 0, ...Array(31).fill(0)]);
    if (type === "address") {
        const out = Buffer.alloc(32);
        const h = String(value).slice(2).padStart(40, "0");
        Buffer.from(h, "hex").copy(out, 12);
        return out;
    }
    if (type.startsWith("int") || type.startsWith("uint")) {
        const out = Buffer.alloc(32);
        let v = BigInt(String(value));
        if (v < 0n)
            v = (1n << 256n) + v;
        for (let i = 31; i >= 0; i--) {
            out[i] = Number(v & 0xffn);
            v >>= 8n;
        }
        return out;
    }
    throw new Error("unsupported primitive type: " + type);
}
function encodeData(type, value, types) {
    if (type.endsWith("[]")) {
        const itemType = type.slice(0, -2);
        const items = value.map((it) => types[itemType] ? hashStruct(itemType, it, types) : encodeField(itemType, it));
        return (0, keccak_1.keccak256)(Buffer.concat(items));
    }
    if (types[type]) {
        return hashStruct(type, value, types);
    }
    return encodeField(type, value);
}
function hashStruct(type, data, types) {
    const parts = [hashType(type, types)];
    for (const f of types[type]) {
        parts.push(encodeData(f.type, data[f.name], types));
    }
    return (0, keccak_1.keccak256)(Buffer.concat(parts));
}
const DOMAIN_FIELDS = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
];
function domainSeparator(domain, types) {
    const present = DOMAIN_FIELDS.filter((f) => domain[f.name] !== undefined);
    const t = { ...types, EIP712Domain: present };
    const data = {};
    for (const f of present)
        data[f.name] = domain[f.name];
    return hashStruct("EIP712Domain", data, t);
}
/** Full EIP-712 digest: keccak(0x1901 || domainSep || hashStruct(primaryType, message)). */
function eip712Digest(domain, types, primaryType, message) {
    const parts = [Buffer.from("1901", "hex")];
    parts.push(domainSeparator(domain, types));
    parts.push(hashStruct(primaryType, message, types));
    return (0, keccak_1.keccak256)(Buffer.concat(parts));
}
function digestHex(domain, types, primaryType, message) {
    return eip712Digest(domain, types, primaryType, message).toString("hex");
}
