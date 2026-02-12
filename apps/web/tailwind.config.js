/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: "#0a0a0a",
        "surface-raised": "#111111",
        "surface-overlay": "#1a1a1a",
        warm: {
          50: "#e8e0d4",
          100: "#d4cdc0",
          200: "#b5ad9f",
          300: "#8a7e6b",
          400: "#6a5f52",
          500: "#5a5245",
        },
      },
      fontFamily: {
        serif: ["var(--font-serif)"],
        sans: ["var(--font-sans)"],
      },
      maxWidth: {
        reader: "680px",
      },
      typography: {
        DEFAULT: {
          css: {
            color: "#d4cdc0",
            lineHeight: "1.8",
          },
        },
      },
    },
  },
  plugins: [],
};
