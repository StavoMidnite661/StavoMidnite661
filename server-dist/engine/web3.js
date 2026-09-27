"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Web3 = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hash_1 = require("../crypto/hash");
const keccak_1 = require("../crypto/keccak");
const eip712_1 = require("../crypto/eip712");
const secp256k1_1 = require("../crypto/secp256k1");
function pubToAddress(pubHex) {
    return "0x" + (0, keccak_1.keccak256)(Buffer.from(pubHex.slice(2), "hex")).toString("hex").slice(24, 64);
}
/**
 * Web3 boundary: secp256k1 keypairs, EIP-712 typed-data signing/verification.
 * The typed-data shape itself is protocol authority — loaded from the
 * compiled registry (domains.yaml → protocol.web3), never hard-coded here.
 */
class Web3 {
    registry;
    keys = [];
    file;
    constructor(file, registry) {
        this.registry = registry;
        this.file = file;
        if (fs_1.default.existsSync(file)) {
            this.keys = JSON.parse(fs_1.default.readFileSync(file, "utf8"));
        }
        else {
            this.createKey("default", "Default Test Wallet");
        }
    }
    persist() {
        fs_1.default.mkdirSync(path_1.default.dirname(this.file), { recursive: true });
        fs_1.default.writeFileSync(this.file, JSON.stringify(this.keys, null, 2));
    }
    createKey(id, name) {
        if (this.keys.some((k) => k.id === id))
            throw new Error(`key "${id}" already exists`);
        const priv = (0, secp256k1_1.generatePrivateKey)();
        const pub = (0, secp256k1_1.privToPub)(priv);
        const key = { id, name, priv, pub, address: pubToAddress(pub), createdAt: new Date().toISOString() };
        this.keys.push(key);
        this.persist();
        return key;
    }
    get(id) {
        return this.keys.find((k) => k.id === id);
    }
    /**
     * Build the EIP-712 message generically from the compiled type: each
     * field of the primary type is coerced per its declared type. Field
     * values arrive keyed by field name — no field names are hard-coded.
     */
    buildMessage(values) {
        const w3 = this.registry.protocol.web3;
        const msg = {};
        for (const f of w3.types[w3.primaryType]) {
            const v = values[f.name];
            if (v === undefined || v === null)
                continue;
            if (f.type === "address") {
                const s = String(v);
                msg[f.name] = /^0x[0-9a-fA-F]{40}$/.test(s) ? s : (0, hash_1.toAddress)(s);
            }
            else if (f.type.startsWith("uint") || f.type.startsWith("int")) {
                msg[f.name] = Number(v);
            }
            else if (f.type === "bool") {
                msg[f.name] = Boolean(v);
            }
            else if (f.type === "bytes") {
                msg[f.name] = String(v).startsWith("0x") ? String(v) : "0x" + String(v);
            }
            else {
                msg[f.name] = String(v);
            }
        }
        return msg;
    }
    sign(keyId, values) {
        const key = this.get(keyId);
        if (!key)
            throw new Error(`key "${keyId}" not found`);
        const w3 = this.registry.protocol.web3;
        const message = this.buildMessage(values);
        const digest = (0, eip712_1.eip712Digest)(w3.domain, w3.types, w3.primaryType, message);
        const sig = (0, secp256k1_1.signDigest)(key.priv, digest);
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
    verify(sig) {
        try {
            let digestHex = sig.digest;
            if (!digestHex && sig.message && sig.domain && sig.types && sig.primaryType) {
                digestHex = (0, eip712_1.eip712Digest)(sig.domain, sig.types, sig.primaryType, sig.message).toString("hex");
            }
            if (!digestHex)
                return { ok: false, reason: "no digest available" };
            const strip = (s) => String(s).replace(/^0x/, "");
            const digest = Buffer.from(strip(digestHex), "hex");
            const ecSig = { r: strip(sig.r), s: strip(sig.s), v: sig.v };
            const recovered = (0, secp256k1_1.recoverPubkey)(digest, ecSig);
            const recoveredAddr = pubToAddress(recovered);
            const valid = this.keys.some((k) => k.address.toLowerCase() === recoveredAddr.toLowerCase());
            if (sig.signer && recoveredAddr.toLowerCase() !== sig.signer.toLowerCase()) {
                return { ok: false, reason: `signer mismatch (recovers ${recoveredAddr})`, recovered: recoveredAddr, digest: digestHex };
            }
            return { ok: valid || !!sig.signer, reason: valid ? undefined : "signer address not in keystore", recovered: recoveredAddr, digest: digestHex };
        }
        catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }
    /** Deterministic compact timestamp used in attestations. */
    static nowStamp() {
        return new Date().toISOString().slice(0, 19).replace(/[-:TZ]/g, "");
    }
    /**
     * Sign an attestation for a verifying command. `values` is keyed by the
     * compiled type's field names; the digest is produced from the compiled
     * domain + types — the same authority the kernel verifies against.
     */
    signForCommand(command, values, keyId) {
        const key = this.get(keyId ?? this.keys[0]?.id);
        if (!key)
            throw new Error("no web3 keys available");
        const w3 = this.registry.protocol.web3;
        void command;
        const full = { ...values, timestamp: Web3.nowStamp() };
        const message = this.buildMessage(full);
        const digest = (0, eip712_1.eip712Digest)(w3.domain, w3.types, w3.primaryType, message);
        const sig = (0, secp256k1_1.signDigest)(key.priv, digest);
        return {
            signature: "0x" + sig.r + sig.s + sig.v.toString(16).padStart(2, "0"),
            signer: key.address,
            digest: digest.toString("hex"),
            timestamp: String(full.timestamp),
        };
    }
    /** Evidence hash over the whole keystore (for audit display). */
    evidenceHash() {
        return (0, hash_1.sha256Hex)(JSON.stringify(this.keys.map((k) => ({ id: k.id, address: k.address, pub: k.pub }))));
    }
}
exports.Web3 = Web3;
