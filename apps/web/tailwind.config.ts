import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    fontSize: {
      xs: ["12px", { lineHeight: "1.45" }],
      sm: ["14px", { lineHeight: "1.45", letterSpacing: "-0.015em" }],
      base: ["14px", { lineHeight: "1.45", letterSpacing: "-0.015em" }],
      lg: ["14px", { lineHeight: "1.45", letterSpacing: "-0.015em" }],
      xl: ["14px", { lineHeight: "1.45", letterSpacing: "-0.015em" }],
      "2xl": ["24px", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
      "3xl": ["24px", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
      "4xl": ["24px", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
      "5xl": ["24px", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
    },
    extend: {
      colors: {
        ink: "var(--color-ink)",
        inkbase: "var(--color-text)",
        paper: "var(--color-paper)",
        app: "var(--color-bg)",
        navy: "var(--color-accent)",
        mist: "var(--color-mist)",
        accent: {
          DEFAULT: "var(--color-accent)",
          100: "var(--color-accent-100)",
          200: "var(--color-accent-200)",
          300: "var(--color-accent-300)",
          400: "var(--color-accent-400)",
          500: "var(--color-accent-500)",
          600: "var(--color-accent-600)",
          700: "var(--color-accent-700)",
          800: "var(--color-accent-800)",
          900: "var(--color-accent-900)",
        },
        divider: "var(--color-divider)",
      },
      fontFamily: {
        heading: ["var(--font)"],
        body: ["var(--font)"],
        sans: ["var(--font)"],
      },
      borderRadius: {
        sm: "var(--r-nav)",
        md: "var(--r-nav)",
        lg: "var(--r-card)",
        xl: "var(--r-card)",
        full: "var(--r-pill)",
      },
      transitionDuration: {
        hover: "120ms",
        select: "180ms",
      },
    },
  },
  plugins: [],
};

export default config;
