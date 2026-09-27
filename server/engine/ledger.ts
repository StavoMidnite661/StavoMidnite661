import fs from "fs";
import path from "path";
import { sha256Hex } from "../crypto/hash";
import type { LedgerAccount, LedgerTransfer } from "./types";

/**
 * Double-entry ledger modeled on TigerBeetle semantics:
 *  - every mutation is a set of legs; debits and credits must balance
 *  - balances are derived from the operation history, never hand-edited
 *  - the reserve account (both directions disabled) anchors total supply
 *  - the invariant sum(all balances) == genesis supply must always hold
 */

const FLAGS_DEBITS_DISABLED = 1;
const FLAGS_CREDITS_DISABLED = 2;

export interface LedgerConfig {
  genesisSupply: number;
  reserve: string;
}

export interface LedgerError {
  code: string;
  message: string;
}

export class Ledger {
  accounts = new Map<string, LedgerAccount>();
  transfers: LedgerTransfer[] = [];
  balances = new Map<string, { debit: number; credit: number }>();
  private file: string;
  private transferSeq = 0;
  readonly genesisSupply: number;
  readonly reserve: string;

  constructor(file: string, config: LedgerConfig, bootstrap: boolean) {
    this.file = file;
    this.genesisSupply = config.genesisSupply;
    this.reserve = config.reserve;
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        accounts: LedgerAccount[];
        transfers: LedgerTransfer[];
      };
      for (const a of raw.accounts) this.accounts.set(a.id, a);
      this.transfers = raw.transfers;
      this.rebuildBalances();
    } else if (bootstrap) {
      this.init();
      this.persist();
    }
  }

  private init(): void {
    const reserve: LedgerAccount = {
      id: this.reserve,
      code: "000000000001",
      name: "Genesis Reserve",
      userId: "ledger-boundary",
      flags: FLAGS_DEBITS_DISABLED | FLAGS_CREDITS_DISABLED,
      createdAt: new Date().toISOString(),
      opening: this.genesisSupply,
    };
    this.accounts.set(this.reserve, reserve);
    this.balances.set(this.reserve, { debit: 0, credit: this.genesisSupply });
  }

  private rebuildBalances(): void {
    this.balances.clear();
    for (const a of this.accounts.values()) {
      this.balances.set(a.id, { debit: 0, credit: 0 });
    }
    const rb = this.balances.get(this.reserve);
    if (rb) rb.credit += this.genesisSupply;
    for (const t of this.transfers) {
      for (const leg of t.legs) {
        const b = this.balances.get(leg.account);
        if (!b) continue;
        if (leg.type === "debit") b.debit += leg.amount;
        else b.credit += leg.amount;
      }
    }
    this.transferSeq = this.transfers.length;
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify({ accounts: [...this.accounts.values()], transfers: this.transfers }, null, 2),
    );
  }

  balance(id: string): number {
    const b = this.balances.get(id);
    if (!b) return 0;
    return b.credit - b.debit;
  }

  account(id: string): LedgerAccount | undefined {
    return this.accounts.get(id);
  }

  listAccounts(): LedgerAccount[] {
    return [...this.accounts.values()].map((a) => ({ ...a, balance: this.balance(a.id) } as LedgerAccount & { balance: number }));
  }

  codeFor(id: string): string {
    return sha256Hex("sovr:code:" + id).slice(0, 24);
  }

  nextTransferId(): string {
    return `tr-${String(this.transferSeq + 1).padStart(5, "0")}`;
  }

  /** Pre-checks + legs for a transfer; no mutation. */
  prepareTransfer(source: string, destination: string, amount: number): LedgerError | null {
    const src = this.accounts.get(source);
    const dst = this.accounts.get(destination);
    if (!src) return { code: "ACCOUNT_MISSING", message: `source account "${source}" does not exist` };
    if (!dst) return { code: "ACCOUNT_MISSING", message: `destination account "${destination}" does not exist` };
    if (source === destination) return { code: "SELF_TRANSFER", message: "source and destination must differ" };
    if (amount <= 0 || !Number.isInteger(amount)) return { code: "BAD_AMOUNT", message: "amount must be a positive integer" };
    if (src.flags & FLAGS_DEBITS_DISABLED) return { code: "DEBITS_DISABLED", message: `account "${source}" has debits disabled` };
    if (dst.flags & FLAGS_CREDITS_DISABLED) return { code: "CREDITS_DISABLED", message: `account "${destination}" has credits disabled` };
    if (this.balance(source) < amount) {
      return { code: "INSUFFICIENT", message: `account "${source}" balance ${this.balance(source)} < ${amount} (balance assertion failed)` };
    }
    return null;
  }

  /** Pre-checks for creating an account with an opening balance from the reserve. */
  prepareCreateAccount(id: string, opening: number): LedgerError | null {
    if (this.accounts.has(id)) return { code: "ACCOUNT_EXISTS", message: `ledger account "${id}" already exists` };
    if (id === this.reserve) return { code: "RESERVED", message: "reserve id is reserved" };
    if (opening < 0 || !Number.isInteger(opening)) return { code: "BAD_AMOUNT", message: "opening must be a non-negative integer" };
    if (opening > 0 && this.balance(this.reserve) < opening) {
      return { code: "INSUFFICIENT", message: "reserve cannot cover the opening balance" };
    }
    return null;
  }

  postCreateAccount(id: string, name: string, userId: string, opening: number): { account: LedgerAccount; transferId: string | null } {
    const account: LedgerAccount = {
      id,
      code: this.codeFor(id),
      name,
      userId,
      flags: 0,
      createdAt: new Date().toISOString(),
      opening,
    };
    this.accounts.set(id, account);
    this.balances.set(id, { debit: 0, credit: 0 });
    let transferId: string | null = null;
    if (opening > 0) {
      const t: LedgerTransfer = {
        id: this.nextTransferId(),
        ts: new Date().toISOString(),
        source: this.reserve,
        destination: id,
        amount: opening,
        memo: "opening balance",
        legs: [
          { account: this.reserve, type: "debit", amount: opening },
          { account: id, type: "credit", amount: opening },
        ],
      };
      this.transfers.push(t);
      const rb = this.balances.get(this.reserve)!;
      rb.debit += opening;
      const ab = this.balances.get(id)!;
      ab.credit += opening;
      transferId = t.id;
    }
    this.persist();
    return { account, transferId };
  }

  postTransfer(source: string, destination: string, amount: number, memo: string): LedgerTransfer {
    const t: LedgerTransfer = {
      id: this.nextTransferId(),
      ts: new Date().toISOString(),
      source,
      destination,
      amount,
      memo,
      legs: [
        { account: source, type: "debit", amount },
        { account: destination, type: "credit", amount },
      ],
    };
    this.transfers.push(t);
    const sb = this.balances.get(source)!;
    const db = this.balances.get(destination)!;
    sb.debit += amount;
    db.credit += amount;
    this.persist();
    return t;
  }

  /**
   * Integrity: rebuild balances from the raw operation history and compare
   * against the live balance map; check every transfer is balanced and the
   * supply invariant holds.
   */
  verify(): {
    doubleEntry: boolean;
    balancesMatch: boolean;
    supplyInvariant: boolean;
    totalBalance: number;
    accounts: number;
    transfers: number;
  } {
    const fresh = new Map<string, { debit: number; credit: number }>();
    for (const a of this.accounts.values()) fresh.set(a.id, { debit: 0, credit: 0 });
    fresh.get(this.reserve)!.credit += this.genesisSupply;
    let doubleEntry = true;
    for (const t of this.transfers) {
      const debits = t.legs.filter((l) => l.type === "debit").reduce((s, l) => s + l.amount, 0);
      const credits = t.legs.filter((l) => l.type === "credit").reduce((s, l) => s + l.amount, 0);
      if (debits !== credits) {
        doubleEntry = false;
        continue;
      }
      for (const leg of t.legs) {
        const b = fresh.get(leg.account);
        if (!b) continue;
        if (leg.type === "debit") b.debit += leg.amount;
        else b.credit += leg.amount;
      }
    }
    let balancesMatch = true;
    let total = 0;
    for (const a of this.accounts.values()) {
      const f = fresh.get(a.id)!;
      const live = this.balances.get(a.id)!;
      if (f.debit !== live.debit || f.credit !== live.credit) balancesMatch = false;
      total += f.credit - f.debit;
    }
    return {
      doubleEntry,
      balancesMatch,
      supplyInvariant: total === this.genesisSupply,
      totalBalance: total,
      accounts: this.accounts.size,
      transfers: this.transfers.length,
    };
  }

  destroy(): void {
    this.accounts.clear();
    this.transfers = [];
    this.balances.clear();
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    this.init();
  }
}
