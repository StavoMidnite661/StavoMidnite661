/**
 * Minimal secp256k1 ECDSA over bigints — enough for EIP-191/712 style
 * signing and verification: sign with RFC 6979 deterministic nonces,
 * verify, and recover the public key from (r, s, v, digest).
 */
import { createHmac, randomBytes } from "crypto";

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const B = 7n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

type Point = { x: bigint; y: bigint } | null;

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function inv(a: bigint, m: bigint): bigint {
  a = mod(a, m);
  let [oldR, r] = [a, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("no modular inverse");
  return mod(oldS, m);
}

function pointAdd(p1: Point, p2: Point): Point {
  if (!p1) return p2;
  if (!p2) return p1;
  const { x: x1, y: y1 } = p1;
  const { x: x2, y: y2 } = p2;
  if (x1 === x2) {
    if (mod(y1 + y2, P) === 0n) return null;
    const m = mod(3n * x1 * x1 * inv(2n * y1, P), P);
    const x3 = mod(m * m - 2n * x1, P);
    return { x: x3, y: mod(m * (x1 - x3) - y1, P) };
  }
  const m = mod((y2 - y1) * inv(mod(x2 - x1, P), P), P);
  const x3 = mod(m * m - x1 - x2, P);
  return { x: x3, y: mod(m * (x1 - x3) - y1, P) };
}

function pointMul(k: bigint, pt: Point): Point {
  let r: Point = null;
  let add: Point = pt;
  let e = mod(k, N);
  while (e > 0n) {
    if (e & 1n) r = pointAdd(r, add);
    add = pointAdd(add, add);
    e >>= 1n;
  }
  return r;
}

const G: Point = { x: GX, y: GY };

function bufToBig(buf: Buffer): bigint {
  return BigInt("0x" + buf.toString("hex"));
}

/** Deterministic k per RFC 6979 using HMAC-SHA256. */
function deterministicK(priv: Buffer, digest: Buffer): bigint {
  const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
  let v = Buffer.alloc(32, 1);
  let k = Buffer.alloc(32, 0);
  k = hmac(k, Buffer.concat([v, Buffer.from([0]), priv, digest]));
  v = hmac(k, v);
  k = hmac(k, Buffer.concat([v, Buffer.from([1]), priv, digest]));
  v = hmac(k, v);
  for (;;) {
    v = hmac(k, v);
    const cand = bufToBig(v);
    if (cand > 0n && cand < N) return cand;
    k = hmac(k, Buffer.concat([v, Buffer.from([0])]));
    v = hmac(k, v);
  }
}

export interface EcSig {
  r: string; // 64-hex
  s: string; // 64-hex (low-s)
  v: number; // 27 | 28
}

export function signDigest(privHex: string, digest: Buffer): EcSig {
  const priv = Buffer.from(privHex, "hex");
  const d = bufToBig(priv);
  if (d <= 0n || d >= N) throw new Error("private key out of range");
  const e = bufToBig(digest);
  for (;;) {
    const k = deterministicK(priv, digest);
    const R = pointMul(k, G);
    if (!R) continue;
    const r = mod(R.x, N);
    if (r === 0n) continue;
    const sRaw = mod(inv(k, N) * mod(e + r * d, N), N);
    if (sRaw === 0n) continue;
    const s = sRaw > N / 2n ? N - sRaw : sRaw;
    const v = 27 + (R.y & 1n ? 1 : 0) + (R.x >= N ? 2 : 0);
    return {
      r: r.toString(16).padStart(64, "0"),
      s: s.toString(16).padStart(64, "0"),
      v,
    };
  }
}

function r2hex(v: bigint): string {
  return v.toString(16).padStart(64, "0");
}

function pointFromR(r: bigint, recId: number): Point {
  const x = r + (recId & 2 ? N : 0n);
  if (x >= P) return null;
  const ySq = mod(mod(x * x, P) * x + B, P);
  const y = modPow(ySq, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== ySq) return null;
  if ((y & 1n) !== BigInt(recId & 1)) return { x, y: mod(-y, P) };
  return { x, y };
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, m);
    base = mod(base * base, m);
    exp >>= 1n;
  }
  return result;
}

/**
 * SEC1 ECDSA verification: P = u1·G + u2·Q must satisfy P.x ≡ r (mod n),
 * where Q is the claimed public key.
 */
export function verifyDigest(digest: Buffer, sig: EcSig, pubHex: string): boolean {
  try {
    const r = BigInt("0x" + sig.r);
    const s = BigInt("0x" + sig.s);
    if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
    const e = mod(bufToBig(digest), N);
    const w = inv(s, N);
    const u1 = mod(e * w, N);
    const u2 = mod(r * w, N);
    const Q: Point = { x: BigInt("0x" + pubHex.slice(2, 66)), y: BigInt("0x" + pubHex.slice(66, 130)) };
    const pt = pointAdd(pointMul(u1, G), pointMul(u2, Q));
    return !!pt && mod(pt.x, N) === r;
  } catch {
    return false;
  }
}

/** Recover uncompressed pubkey hex (0x + 128 hex) from a signature. */
export function recoverPubkey(digest: Buffer, sig: EcSig): string {
  const r = BigInt("0x" + sig.r);
  const s = BigInt("0x" + sig.s);
  const e = bufToBig(digest);
  const R = pointFromR(r, sig.v - 27);
  if (!R) throw new Error("recovery failed: no curve point for r");
  const rInv = inv(r, N);
  const Q = pointAdd(pointMul(mod(-e * rInv, N), G), pointMul(mod(s * rInv, N), R));
  if (!Q) throw new Error("recovery failed");
  return "0x" + r2hex(Q.x) + r2hex(Q.y);
}

export function privToPub(privHex: string): string {
  const P1 = pointMul(bufToBig(Buffer.from(privHex, "hex")), G);
  if (!P1) throw new Error("invalid private key");
  return "0x" + r2hex(P1.x) + r2hex(P1.y);
}

export function generatePrivateKey(): string {
  for (;;) {
    const buf = randomBytes(32);
    const v = bufToBig(buf);
    if (v > 0n && v < N) return v.toString(16).padStart(64, "0");
  }
}
