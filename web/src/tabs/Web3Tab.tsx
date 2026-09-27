import React, { useState } from "react";
import { api, shortHash } from "../api";
import { Chip, KV, OkBadge, Panel, Spinner, useAsync } from "../ui";

export function Web3Tab() {
  const { data, loading, reload } = useAsync(() => api.web3Keys().then((r) => ({ keys: r.data, evidence: r.evidenceHash })), [], 4000);
  const [keyId, setKeyId] = useState("default");
  const [orderId, setOrderId] = useState("");
  const [payer, setPayer] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("25000000");
  const [name, setName] = useState("");
  const [signOut, setSignOut] = useState<any>();
  const [verifyOut, setVerifyOut] = useState<any>();
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Spinner label="loading web3 keystore…" />;
  if (!data) return null;
  const keys = data.keys;

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api.web3CreateKey(name.trim());
      setName("");
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const sign = async () => {
    setBusy(true);
    try {
      const r = await api.web3Sign(keyId, orderId, payer, payee, Number(amount));
      setSignOut(r.data);
      setVerifyOut(undefined);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!signOut) return;
    setBusy(true);
    try {
      const r = await api.web3Verify({
        digest: signOut.digest,
        r: signOut.r,
        s: signOut.s,
        v: signOut.v,
        signer: signOut.signer,
      });
      setVerifyOut(r.data);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tamper = async () => {
    if (!signOut) return;
    // flip one hex nibble of r to demonstrate recovery mismatch
    const r = signOut.r.replace(/^0x/, "");
    const tampered = (r[0] === "0" ? "1" : "0") + r.slice(1);
    try {
      const r2 = await api.web3Verify({ digest: signOut.digest, r: "0x" + tampered, s: signOut.s, v: signOut.v, signer: signOut.signer });
      setVerifyOut(r2.data);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const reveal = async (id: string) => {
    try {
      const r = await api.web3Reveal(id);
      setRevealed((x) => ({ ...x, [id]: r.data.priv }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <div className="space-y-5">
        <Panel title="Key Store — secp256k1" right={<div className="flex items-center gap-2"><Chip tone="web3">real ECDSA</Chip><Chip tone="dim">{keys.length} keys</Chip></div>}>
          <div className="space-y-3">
            {keys.map((k) => (
              <div key={k.id} className="bg-abyss/60 border border-edge/60 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12.5px] font-semibold text-slate-100">{k.id}</span>
                  <span className="text-[10.5px] text-slate-500">{k.name}</span>
                  <span className="flex-1" />
                  <button className="btn-ghost px-2 py-1 text-[10.5px]" onClick={() => reveal(k.id)}>
                    {revealed[k.id] ? "hide key" : "reveal key"}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-600">addr </span>
                    <span className="text-web3 break-all">{k.address}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">pub </span>
                    <span className="text-slate-400 break-all">{shortHash(k.pub, 18)}</span>
                  </div>
                  {revealed[k.id] ? (
                    <div className="md:col-span-2 break-all text-amber">{revealed[k.id]}</div>
                  ) : (
                    <div>
                      <span className="text-slate-600">priv </span>
                      <span className="text-slate-500">{k.privMasked}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input className="input flex-1" placeholder="new wallet name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-neon" onClick={create}>
              Create key
            </button>
          </div>
          <div className="mt-3 text-[10.5px] font-mono text-slate-600">
            keystore evidence <span className="text-neon-soft">{shortHash(data.evidence, 14)}</span>
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel title="EIP-712 Signing" right={<Chip tone="web3">SettlementAttestation</Chip>}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Key</label>
              <select className="input" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Order ID</label>
              <input className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="wx-po-…" />
            </div>
            <div>
              <label className="label">Payer</label>
              <input className="input" value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="wx-payer-…" />
            </div>
            <div>
              <label className="label">Payee</label>
              <input className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="wx-payee-…" />
            </div>
            <div>
              <label className="label">Amount (μSOVR)</label>
              <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex items-end">
              <button className="btn-neon w-full" onClick={sign} disabled={busy}>
                Sign attestation
              </button>
            </div>
          </div>

          {signOut && (
            <div className="mt-4 bg-abyss/70 border border-edge/60 rounded-lg p-3 space-y-1.5 text-[11px] font-mono">
              <KV k="digest" v={<span className="text-neon-soft break-all">{signOut.digest}</span>} />
              <KV k="signature" v={<span className="break-all text-slate-400">{shortHash(signOut.signature, 32)}</span>} />
              <KV k="signer" v={<span className="text-web3">{signOut.signer}</span>} />
              <KV k="timestamp" v={signOut.timestamp} />
              <div className="flex gap-2 pt-2">
                <button className="btn-ghost px-2.5 py-1.5 text-[11px]" onClick={verify} disabled={busy}>
                  Verify signature
                </button>
                <button className="btn-danger px-2.5 py-1.5 text-[11px]" onClick={tamper} disabled={busy}>
                  Verify tampered (flip r)
                </button>
              </div>
            </div>
          )}

          {verifyOut && (
            <div className={`mt-3 rounded-lg px-3 py-2.5 text-[12px] font-mono border ${verifyOut.ok ? "bg-ok/10 border-ok/30 text-ok" : "bg-danger/10 border-danger/30 text-danger"}`}>
              <div className="flex items-center gap-2">
                <OkBadge ok={verifyOut.ok} okText="SIGNATURE VALID" badText="SIGNATURE INVALID" />
                {verifyOut.reason && <span>{verifyOut.reason}</span>}
              </div>
              {verifyOut.recovered && (
                <div className="mt-1.5 text-[11px] opacity-80">
                  recovered signer: <span className="break-all">{verifyOut.recovered}</span>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
