import { defineConfig } from "tsup"

export default defineConfig({
  format: ["esm"],
  dts: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral",
  external: [
    /^@hachej\/boring-/,
    "react",
    "react-dom",
    "react/jsx-runtime",
    /^node:/,
  ],
  entry: {
    "front/descriptor": "src/front/descriptor.tsx",
  },
  splitting: true,
  clean: false,
})
