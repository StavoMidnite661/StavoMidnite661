"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const routes_1 = __importDefault(require("./api/routes"));
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT ?? 5173);
app.use(express_1.default.json({ limit: "2mb" }));
// API
app.use("/api", routes_1.default);
// Static web build (vite output) + brand asset
const distDir = path_1.default.join(__dirname, "..", "web", "dist");
const logoPath = path_1.default.join(__dirname, "..", "src", "assets", "images", "sovr-logo.png");
app.get("/logo.png", (_req, res) => {
    res.sendFile(logoPath);
});
app.get("/favicon.ico", (_req, res) => {
    res.sendFile(logoPath);
});
if (fs_1.default.existsSync(distDir)) {
    app.use(express_1.default.static(distDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
        res.sendFile(path_1.default.join(distDir, "index.html"));
    });
}
else {
    app.get("/", (_req, res) => {
        res.type("text/plain").send("SOVR Empire API is running. Web build missing — run `npm run build:web` first. Try /api/health.");
    });
}
app.use((err, _req, res, _next) => {
    console.error("[sovr] unhandled error:", err);
    res.status(500).json({ ok: false, error: "internal error" });
});
app.listen(PORT, "0.0.0.0", () => {
    console.log(`[sovr] SOVR Empire operational — http://0.0.0.0:${PORT}`);
});
