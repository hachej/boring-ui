import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.ts",
    "server/index": "src/server/index.ts",
    "shared/index": "src/shared/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  platform: "neutral",
  target: "es2022",
  external: [
    /^@hachej\/boring-/,
    "react",
    "react-dom",
    "react/jsx-runtime",
  ],
})
