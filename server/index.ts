import express from "express";
import path from "path";
import fs from "fs";
import routes from "./api/routes";

const app = express();
const PORT = Number(process.env.PORT ?? 5173);

app.use(express.json({ limit: "2mb" }));

// API
app.use("/api", routes);

// Static web build (vite output) + brand asset
const distDir = path.join(__dirname, "..", "web", "dist");
const logoPath = path.join(__dirname, "..", "src", "assets", "images", "sovr-logo.png");
app.get("/logo.png", (_req, res) => {
  res.sendFile(logoPath);
});
app.get("/favicon.ico", (_req, res) => {
  res.sendFile(logoPath);
});
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.type("text/plain").send("SOVR Empire API is running. Web build missing — run `npm run build:web` first. Try /api/health.");
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[sovr] unhandled error:", err);
  res.status(500).json({ ok: false, error: "internal error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[sovr] SOVR Empire operational — http://0.0.0.0:${PORT}`);
});
