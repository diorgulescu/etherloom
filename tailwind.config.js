/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        loom: {
          canvas: "#0D1321",
          panel: "#111827",
          card: "#162032",
          cardHover: "#1E2B42",
          terminal: "#090E18",
          grid: "#1E2D45",
          cyan: "#22D3EE",
          cyanDeep: "#06B6D4",
          emerald: "#10B981",
          emeraldBright: "#34D399",
          indigo: "#6366F1",
          indigoBright: "#818CF8",
          amber: "#F59E0B",
          rose: "#F43F5E",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          '"SF Mono"',
          '"JetBrains Mono"',
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        "loom-cyan":
          "0 0 0 1px rgba(34, 211, 238, 0.45), 0 0 22px rgba(34, 211, 238, 0.18)",
        "loom-card":
          "0 10px 28px -8px rgba(4, 8, 16, 0.65), 0 0 0 1px rgba(34, 211, 238, 0.12)",
      },
    },
  },
  plugins: [],
};
