import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0d1c38",
        "ink-soft": "#24365c",
        accent: "#1a61e6",
        "accent-deep": "#123d9e",
        "accent-soft": "#edf4ff",
        mist: "#f5f7ff",
        line: "#d1e0f5",
      },
      boxShadow: {
        panel: "0 20px 60px rgba(13, 28, 56, 0.12)",
        control: "0 10px 25px rgba(26, 97, 230, 0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
