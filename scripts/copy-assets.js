const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src", "assets", "images", "sovr-logo.png");
const outDir = path.join(__dirname, "..", "web", "public");

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, path.join(outDir, "logo.png"));
console.log("[copy-assets] logo ->", path.join(outDir, "logo.png"));
