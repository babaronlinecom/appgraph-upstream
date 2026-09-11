import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--ag-bg-canvas)",
        panel: "var(--ag-bg-panel)",
        elevated: "var(--ag-bg-elevated)",
        overlay: "var(--ag-bg-overlay)",
        line: {
          DEFAULT: "var(--ag-border)",
          strong: "var(--ag-border-strong)",
        },
        ink: {
          DEFAULT: "var(--ag-text-primary)",
          secondary: "var(--ag-text-secondary)",
          muted: "var(--ag-text-muted)",
        },
        accent: {
          DEFAULT: "var(--ag-accent)",
          soft: "var(--ag-accent-soft)",
          ink: "var(--ag-accent-ink)",
        },
        success: "var(--ag-success)",
        warning: "var(--ag-warning)",
        danger: "var(--ag-danger)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "JetBrains Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        float: "0 12px 40px -12px rgba(0,0,0,0.75)",
      },
      transitionDuration: {
        "180": "180ms",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", translate: "0 6px" },
          to: { opacity: "1", translate: "0 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 220ms ease-out both",
        "slide-up": "slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
