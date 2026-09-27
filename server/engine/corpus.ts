import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { sha256Hex, stableStringify } from "../crypto/hash";
import type { CorpusFiles } from "./types";

/**
 * Resolve the protocol corpus directory from the compiled location:
 *  - dev layout:      server/engine        → server/protocol
 *  - compiled layout: server-dist/engine   → server/protocol (repo root)
 * The corpus is the .yaml files themselves — the single protocol source.
 */
export const PROTOCOL_DIR: string = (() => {
  const candidates = [
    path.join(__dirname, "..", "protocol"),
    path.join(__dirname, "..", "..", "server", "protocol"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "domains.yaml"))) return c;
  }
  throw new Error("protocol corpus not found (server/protocol/domains.yaml)");
})();

export const CORPUS_FILES = [
  "domains.yaml",
  "identities.yaml",
  "capabilities.yaml",
  "state-machines.yaml",
  "events.yaml",
  "commands.yaml",
  "governance.yaml",
  "projections.yaml",
  "scenarios.yaml",
] as const;

const FILE_KEYS: Record<string, keyof CorpusFiles["data"]> = {
  "domains.yaml": "domains",
  "identities.yaml": "identities",
  "capabilities.yaml": "capabilities",
  "state-machines.yaml": "state-machines",
  "events.yaml": "events",
  "commands.yaml": "commands",
  "governance.yaml": "governance",
  "projections.yaml": "projections",
  "scenarios.yaml": "scenarios",
};

/** Load the protocol corpus in a fixed, deterministic file order. */
export function loadCorpus(dir: string = PROTOCOL_DIR): CorpusFiles {
  const files: Record<string, string> = {};
  const data: CorpusFiles["data"] = {
    domains: null,
    identities: null,
    capabilities: null,
    "state-machines": null,
    events: null,
    commands: null,
    governance: null,
    projections: null,
    scenarios: null,
  };
  for (const name of CORPUS_FILES) {
    const p = path.join(dir, name);
    const raw = fs.readFileSync(p, "utf8");
    files[name] = raw;
    data[FILE_KEYS[name]] = yaml.load(raw);
  }
  return { files, data };
}

/** Deterministic hash of the corpus source (byte-exact concatenation). */
export function corpusHash(files: Record<string, string>): string {
  let h = "";
  for (const name of CORPUS_FILES) {
    h += name + ":" + files[name] + "\n";
  }
  return sha256Hex(h);
}

/** Apply a fault injection to a deep-copied corpus (compiler fail-closed demo). */
export function injectFault(
  data: CorpusFiles["data"],
  fault: "unknown_event" | "missing_initial" | "unknown_capability",
): CorpusFiles["data"] {
  const clone: CorpusFiles["data"] = JSON.parse(JSON.stringify(data));
  if (fault === "unknown_event") {
    const cmds = clone.commands as any;
    cmds.commands[0].emits[0].event = "NoSuchEvent";
  } else if (fault === "missing_initial") {
    const m = clone["state-machines"] as any;
    m.machines[0].initial = "ghost_state";
  } else if (fault === "unknown_capability") {
    const cmds = clone.commands as any;
    cmds.commands[0].capabilities.push("capability:missing");
  }
  return clone;
}

export function corpusCanonical(data: CorpusFiles["data"]): string {
  return stableStringify(data);
}
