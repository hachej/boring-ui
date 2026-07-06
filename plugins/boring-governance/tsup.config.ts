import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.tsx",
    "server/index": "src/server/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral",
  external: [
    /^@hachej\/boring-(agent|bash|core|ui-kit)(\/.*)?$/,
    "fastify",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "yaml",
  ],
})
