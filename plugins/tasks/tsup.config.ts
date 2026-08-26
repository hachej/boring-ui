import { defineConfig } from "tsup"

const sharedOptions = {
  format: ["esm"] as const,
  dts: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral" as const,
  external: [
    /^@hachej\/boring-/,
    "react",
    "react-dom",
    "react/jsx-runtime",
    /^node:/,
  ],
}

export default defineConfig({
  ...sharedOptions,
  entry: {
    "front/index": "src/front/index.tsx",
    "server/index": "src/server/index.ts",
    "shared/index": "src/shared/index.ts",
  },
  splitting: false,
  clean: true,
})
