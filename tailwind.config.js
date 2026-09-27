/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["web/index.html", "web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#03080b",
        abyss: "#061014",
        panel: "#0a161c",
        panel2: "#0d1e25",
        edge: "#133039",
        edge2: "#1b4552",
        neon: { DEFAULT: "#33e0ff", soft: "#8df2ff", dim: "#0f6d7e" },
        ok: "#00ff9d",
        web3: "#7B61FF",
        gold: "#FFD700",
        danger: "#ff5470",
        amber: "#ffb84d",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(51,224,255,0.16)",
        "glow-lg": "0 0 64px rgba(51,224,255,0.22)",
      },
    },
  },
  plugins: [],
};
