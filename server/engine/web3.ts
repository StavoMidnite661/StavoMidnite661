import fs from "fs";
import path from "path";
import { sha256Hex, toAddress } from "../crypto/hash";
import { keccak256 } from "../crypto/keccak";
import { eip712Digest } from "../crypto/eip712";
import { generatePrivateKey, privToPub, signDigest, verifyDigest, recoverPubkey, type EcSig } from "../crypto/secp256k1";
import type { Registry } from "./types";

export interface Web3Key {
  id: string;
  name: string;
  priv: string; // 64-hex (demo keystore; production would use HSM)
  pub: string; // 0x + 128-hex uncompressed
  address: string; // 0x + 40-hex
  createdAt: string;
}

export interface SignedAttestation {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
  digest: string; // 64-hex
  r: string;
  s: string;
  v: number;
  signature: string; // 0x + r + s + v
  signer: string;
  keyId: string;
}

function pubToAddress(pubHex: string): string {
  return "0x" + keccak256(Buffer.from(pubHex.slice(2), "hex")).toString("hex").slice(24, 64);
}

/**
 * Web3 boundary: secp256k1 keypairs, EIP-712 typed-data signing/verification.
 * The typed-data shape itself is protocol authority — loaded from the
 * compiled registry (domains.yaml → protocol.web3), never hard-coded here.
 */
export class Web3 {
  keys: Web3Key[] = [];
  private file: string;

  constructor(file: string, private registry: Registry) {
    this.file = file;
    if (fs.existsSync(file)) {
      this.keys = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      this.createKey("default", "Default Test Wallet");
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.keys, null, 2));
  }

  createKey(id: string, name: string): Web3Key {
    if (this.keys.some((k) => k.id === id)) throw new Error(`key "${id}" already exists`);
    const priv = generatePrivateKey();
    const pub = privToPub(priv);
    const key: Web3Key = { id, name, priv, pub, address: pubToAddress(pub), createdAt: new Date().toISOString() };
    this.keys.push(key);
    this.persist();
    return key;
  }

  get(id: string): Web3Key | undefined {
    return this.keys.find((k) => k.id === id);
  }

  /**
   * Build the EIP-712 message generically from the compiled type: each
   * field of the primary type is coerced per its declared type. Field
   * values arrive keyed by field name — no field names are hard-coded.
   */
  buildMessage(values: Record<string, unknown>): Record<string, unknown> {
    const w3 = this.registry.protocol.web3!;
    const msg: Record<string, unknown> = {};
    for (const f of w3.types[w3.primaryType]) {
      const v = values[f.name];
      if (v === undefined || v === null) continue;
      if (f.type === "address") {
        const s = String(v);
        msg[f.name] = /^0x[0-9a-fA-F]{40}$/.test(s) ? s : toAddress(s);
      } else if (f.type.startsWith("uint") || f.type.startsWith("int")) {
        msg[f.name] = Number(v);
      } else if (f.type === "bool") {
        msg[f.name] = Boolean(v);
      } else if (f.type === "bytes") {
        msg[f.name] = String(v).startsWith("0x") ? String(v) : "0x" + String(v);
      } else {
        msg[f.name] = String(v);
      }
    }
    return msg;
  }

  sign(keyId: string, values: Record<string, unknown>): SignedAttestation {
    const key = this.get(keyId);
    if (!key) throw new Error(`key "${keyId}" not found`);
    const w3 = this.registry.protocol.web3!;
    const message = this.buildMessage(values);
    const digest = eip712Digest(w3.domain as any, w3.types as any, w3.primaryType, message);
    const sig: EcSig = signDigest(key.priv, digest);
    return {
      domain: w3.domain,
      types: w3.types,
      primaryType: w3.primaryType,
      message,
      digest: digest.toString("hex"),
      r: sig.r,
      s: sig.s,
      v: sig.v,
      signature: "0x" + sig.r + sig.s + sig.v.toString(16).padStart(2, "0"),
      signer: key.address,
      keyId,
    };
  }

  verify(sig: { digest?: string; r: string; s: string; v: number; signer: string; message?: Record<string, unknown>; domain?: Record<string, unknown>; types?: Record<string, { name: string; type: string }[]>; primaryType?: string }): {
    ok: boolean;
    reason?: string;
    recovered?: string;
    digest?: string;
  } {
    try {
      let digestHex = sig.digest;
      if (!digestHex && sig.message && sig.domain && sig.types && sig.primaryType) {
        digestHex = eip712Digest(sig.domain as any, sig.types as any, sig.primaryType, sig.message).toString("hex");
      }
      if (!digestHex) return { ok: false, reason: "no digest available" };
      const strip = (s: string) => String(s).replace(/^0x/, "");
      const digest = Buffer.from(strip(digestHex), "hex");
      const ecSig: EcSig = { r: strip(sig.r), s: strip(sig.s), v: sig.v };
      const recovered = recoverPubkey(digest, ecSig);
      const recoveredAddr = pubToAddress(recovered);
      const valid = this.keys.some((k) => k.address.toLowerCase() === recoveredAddr.toLowerCase());
      if (sig.signer && recoveredAddr.toLowerCase() !== sig.signer.toLowerCase()) {
        return { ok: false, reason: `signer mismatch (recovers ${recoveredAddr})`, recovered: recoveredAddr, digest: digestHex };
      }
      return { ok: valid || !!sig.signer, reason: valid ? undefined : "signer address not in keystore", recovered: recoveredAddr, digest: digestHex };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Deterministic compact timestamp used in attestations. */
  static nowStamp(): string {
    return new Date().toISOString().slice(0, 19).replace(/[-:TZ]/g, "");
  }

  /**
   * Sign an attestation for a verifying command. `values` is keyed by the
   * compiled type's field names; the digest is produced from the compiled
   * domain + types — the same authority the kernel verifies against.
   */
  signForCommand(command: string, values: Record<string, unknown>, keyId?: string): { signature: string; signer: string; digest: string; timestamp: string } {
    const key = this.get(keyId ?? this.keys[0]?.id);
    if (!key) throw new Error("no web3 keys available");
    const w3 = this.registry.protocol.web3!;
    void command;
    const full = { ...values, timestamp: Web3.nowStamp() };
    const message = this.buildMessage(full);
    const digest = eip712Digest(w3.domain as any, w3.types as any, w3.primaryType, message);
    const sig = signDigest(key.priv, digest);
    return {
      signature: "0x" + sig.r + sig.s + sig.v.toString(16).padStart(2, "0"),
      signer: key.address,
      digest: digest.toString("hex"),
      timestamp: String(full.timestamp),
    };
  }

  /** Evidence hash over the whole keystore (for audit display). */
  evidenceHash(): string {
    return sha256Hex(JSON.stringify(this.keys.map((k) => ({ id: k.id, address: k.address, pub: k.pub }))));
  }
}
