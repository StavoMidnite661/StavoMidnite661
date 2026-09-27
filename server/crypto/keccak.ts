/**
 * Pure-TypeScript Keccak-256 (the pre-NIST original Keccak as used by
 * Ethereum), no dependencies. Verified against the canonical vector
 * keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470.
 */

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets: ROT[x][y], x = lane column (0..4)
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const MASK = (1n << 64n) - 1n;

function rotl(x: bigint, n: number): bigint {
  n = n % 64;
  if (n === 0) return x & MASK;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;
}

function keccakF(state: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // θ
    const c = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) state[x + 5 * y] ^= d;
    }
    // ρ and π
    const b = new Array<bigint>(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROT[x][y]);
      }
    }
    // χ
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] = b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y] & MASK) & b[((x + 2) % 5) + 5 * y]);
      }
    }
    // ι
    state[0] ^= RC[round];
  }
}

/** Keccak-256 of arbitrary bytes, returned as 32-byte Buffer. */
export function keccak256(input: Buffer): Buffer {
  const rate = 136; // bytes for 256-bit output
  const capacity = 32;
  const padded = Buffer.alloc(Math.ceil((input.length + 1) / rate) * rate);
  input.copy(padded);
  padded[input.length] |= 0x01; // Keccak padding (not SHA3's 0x06)
  padded[padded.length - 1] |= 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let block = 0; block < padded.length; block += rate) {
    for (let i = 0; i < rate / 8; i++) {
      state[i] ^= padded.readBigUInt64LE(block + i * 8);
    }
    keccakF(state);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < capacity / 8; i++) {
    out.writeUIntLE(Number(state[i] & 0xffffffffn), i * 8, 4);
    out.writeUIntLE(Number((state[i] >> 32n) & 0xffffffffn), i * 8 + 4, 4);
  }
  return out;
}

/** Keccak-256 of a hex string (even length), returned as hex. */
export function keccak256Hex(hex: string): string {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  return keccak256(Buffer.from(hex, "hex")).toString("hex");
}

/** Keccak-256 of a UTF-8 string, returned as hex. */
export function keccak256Str(s: string): string {
  return keccak256(Buffer.from(s, "utf8")).toString("hex");
}
