/**
 * EIP-712 typed data hashing (Ethereum), implemented over our Keccak-256.
 * Produces the exact 32-byte domain separator / struct hashes defined by
 * the EIP-712 specification.
 */
import { keccak256, keccak256Str } from "./keccak";

export type TdField = { name: string; type: string };
export type TdTypes = Record<string, TdField[]>;

/**
 * EIP-712 encodeType: primary type's field list, followed by all dependent
 * struct types in alphabetical order with their field lists.
 */
function encodeType(type: string, types: TdTypes): string {
  const deps: string[] = [];
  const visit = (t: string) => {
    if (!types[t] || deps.includes(t)) return;
    deps.push(t);
    for (const f of types[t]) {
      const base = f.type.replace(/\[\]$/, "");
      if (types[base]) visit(base);
    }
  };
  visit(type);
  const rest = deps.filter((d) => d !== type).sort();
  const fieldList = (t: string) => types[t].map((f) => f.type + " " + f.name).join(",");
  return `${type}(${fieldList(type)})` + rest.map((d) => `${d}(${fieldList(d)})`).join("");
}

function hashType(type: string, types: TdTypes): Buffer {
  return keccak256(Buffer.from(encodeType(type, types), "utf8"));
}

function encodeField(type: string, value: unknown): Buffer {
  if (type === "string") return keccak256(Buffer.from(String(value), "utf8"));
  if (type === "bytes") {
    let hex = String(value);
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return keccak256(Buffer.from(hex, "hex"));
  }
  if (type === "bool") return Buffer.from([value ? 1 : 0, ...Array(31).fill(0)]);
  if (type === "address") {
    const out = Buffer.alloc(32);
    const h = String(value).slice(2).padStart(40, "0");
    Buffer.from(h, "hex").copy(out, 12);
    return out;
  }
  if (type.startsWith("int") || type.startsWith("uint")) {
    const out = Buffer.alloc(32);
    let v = BigInt(String(value));
    if (v < 0n) v = (1n << 256n) + v;
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  }
  throw new Error("unsupported primitive type: " + type);
}

function encodeData(type: string, value: unknown, types: TdTypes): Buffer {
  if (type.endsWith("[]")) {
    const itemType = type.slice(0, -2);
    const items = (value as unknown[]).map((it) =>
      types[itemType] ? hashStruct(itemType, it as Record<string, unknown>, types) : encodeField(itemType, it),
    );
    return keccak256(Buffer.concat(items));
  }
  if (types[type]) {
    return hashStruct(type, value as Record<string, unknown>, types);
  }
  return encodeField(type, value);
}

export function hashStruct(type: string, data: Record<string, unknown>, types: TdTypes): Buffer {
  const parts: Buffer[] = [hashType(type, types)];
  for (const f of types[type]) {
    parts.push(encodeData(f.type, data[f.name], types));
  }
  return keccak256(Buffer.concat(parts));
}

export interface Eip712Domain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

const DOMAIN_FIELDS: TdField[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
];

export function domainSeparator(domain: Eip712Domain, types: TdTypes): Buffer {
  const present: TdField[] = DOMAIN_FIELDS.filter((f) => domain[f.name as keyof Eip712Domain] !== undefined);
  const t: TdTypes = { ...types, EIP712Domain: present };
  const data: Record<string, unknown> = {};
  for (const f of present) data[f.name] = domain[f.name as keyof Eip712Domain];
  return hashStruct("EIP712Domain", data, t);
}

/** Full EIP-712 digest: keccak(0x1901 || domainSep || hashStruct(primaryType, message)). */
export function eip712Digest(
  domain: Eip712Domain,
  types: TdTypes,
  primaryType: string,
  message: Record<string, unknown>,
): Buffer {
  const parts: Buffer[] = [Buffer.from("1901", "hex")];
  parts.push(domainSeparator(domain, types));
  parts.push(hashStruct(primaryType, message, types));
  return keccak256(Buffer.concat(parts));
}

export function digestHex(
  domain: Eip712Domain,
  types: TdTypes,
  primaryType: string,
  message: Record<string, unknown>,
): string {
  return eip712Digest(domain, types, primaryType, message).toString("hex");
}

/** Utility: keccak of utf8 (exposed for demos/derived ids). */
export { keccak256Str };
