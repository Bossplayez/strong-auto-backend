import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand green
        green: {
          50: "#ecfdf3",
          100: "#d1fadf",
          200: "#a7f3c4",
          300: "#6ee7a3",
          400: "#34d57e",
          500: "#22c55e",
          600: "#1aa050",
          700: "#157f40",
          800: "#115e30",
        },
        // Brand navy
        navy: {
          50: "#f3f5f8",
          100: "#e5e8ee",
          200: "#c8cdd8",
          300: "#9aa3b4",
          400: "#6c7589",
          500: "#4a5366",
          600: "#343c4d",
          700: "#252b3a",
          800: "#1c2230",
          900: "#131825",
        },
        // Semantic
        primary: "#22c55e",
        "primary-hover": "#1aa050",
        background: "#f3f4f5",
        "bg-card": "#ffffff",
        "bg-dark": "#1c2230",
        "bg-darker": "#131825",
        fg: "#131825",
        "fg-muted": "#4a5366",
        "fg-subtle": "#9ea4ad",
        border: "#e6e8eb",
        "border-strong": "#cdd1d6",
      },
      fontFamily: {
        display: ['"Oswald"', '"Arial Narrow"', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        DEFAULT: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(15,23,42,0.04)",
        sm: "0 1px 3px rgba(15,23,42,0.06)",
        md: "0 4px 12px rgba(15,23,42,0.08)",
        lg: "0 12px 28px rgba(15,23,42,0.12)",
        focus: "0 0 0 3px rgba(34,197,94,0.30)",
      },
      maxWidth: {
        container: "1200px",
      },
    },
  },
  plugins: [],
};

export default config;
