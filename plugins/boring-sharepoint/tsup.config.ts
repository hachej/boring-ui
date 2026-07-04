import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.ts",
    "shared/index": "src/shared/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral",
  external: [
    /^@hachej\/boring-/,
    "react",
    "react-dom",
    "react/jsx-runtime",
  ],
})
