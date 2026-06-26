import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "front/index.tsx",
  },
  format: ["esm"],
  dts: false,
  splitting: false,
  clean: true,
  platform: "neutral",
  target: "es2022",
  external: [
    /^@hachej\/boring-/,
    "react",
    "react-dom",
    "react/jsx-runtime",
    "recharts",
  ],
})
