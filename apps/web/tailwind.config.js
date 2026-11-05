export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { fog: "#E4EAE7", paper: "#F6F8F6", ink: "#16233A", slate: "#56667A", pool: "#0B6B70", flare: "#F0A202", alarm: "#A8261C", line: "#C9D3CF" },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', "system-ui", "sans-serif"],
        body: ['"Atkinson Hyperlegible"', "system-ui", "sans-serif"],
      },
    },
  },
};
