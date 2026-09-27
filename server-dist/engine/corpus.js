"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORPUS_FILES = exports.PROTOCOL_DIR = void 0;
exports.loadCorpus = loadCorpus;
exports.corpusHash = corpusHash;
exports.injectFault = injectFault;
exports.corpusCanonical = corpusCanonical;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const hash_1 = require("../crypto/hash");
/**
 * Resolve the protocol corpus directory from the compiled location:
 *  - dev layout:      server/engine        → server/protocol
 *  - compiled layout: server-dist/engine   → server/protocol (repo root)
 * The corpus is the .yaml files themselves — the single protocol source.
 */
exports.PROTOCOL_DIR = (() => {
    const candidates = [
        path_1.default.join(__dirname, "..", "protocol"),
        path_1.default.join(__dirname, "..", "..", "server", "protocol"),
    ];
    for (const c of candidates) {
        if (fs_1.default.existsSync(path_1.default.join(c, "domains.yaml")))
            return c;
    }
    throw new Error("protocol corpus not found (server/protocol/domains.yaml)");
})();
exports.CORPUS_FILES = [
    "domains.yaml",
    "identities.yaml",
    "capabilities.yaml",
    "state-machines.yaml",
    "events.yaml",
    "commands.yaml",
    "governance.yaml",
    "projections.yaml",
    "scenarios.yaml",
];
const FILE_KEYS = {
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
function loadCorpus(dir = exports.PROTOCOL_DIR) {
    const files = {};
    const data = {
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
    for (const name of exports.CORPUS_FILES) {
        const p = path_1.default.join(dir, name);
        const raw = fs_1.default.readFileSync(p, "utf8");
        files[name] = raw;
        data[FILE_KEYS[name]] = js_yaml_1.default.load(raw);
    }
    return { files, data };
}
/** Deterministic hash of the corpus source (byte-exact concatenation). */
function corpusHash(files) {
    let h = "";
    for (const name of exports.CORPUS_FILES) {
        h += name + ":" + files[name] + "\n";
    }
    return (0, hash_1.sha256Hex)(h);
}
/** Apply a fault injection to a deep-copied corpus (compiler fail-closed demo). */
function injectFault(data, fault) {
    const clone = JSON.parse(JSON.stringify(data));
    if (fault === "unknown_event") {
        const cmds = clone.commands;
        cmds.commands[0].emits[0].event = "NoSuchEvent";
    }
    else if (fault === "missing_initial") {
        const m = clone["state-machines"];
        m.machines[0].initial = "ghost_state";
    }
    else if (fault === "unknown_capability") {
        const cmds = clone.commands;
        cmds.commands[0].capabilities.push("capability:missing");
    }
    return clone;
}
function corpusCanonical(data) {
    return (0, hash_1.stableStringify)(data);
}
