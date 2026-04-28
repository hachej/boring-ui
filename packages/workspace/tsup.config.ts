import { defineConfig } from "tsup"

const PEER_EXTERNALS = ["react", "react-dom", "react/jsx-runtime"]

export default defineConfig({
  entry: {
    server: "src/server/index.ts",
    shared: "src/shared/index.ts",
  },
  format: ["esm"],
  dts: { resolve: false, entry: { server: "src/server/index.ts", shared: "src/shared/index.ts" } },
  tsconfig: "tsconfig.tsup.json",
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral",
  external: [...PEER_EXTERNALS, /^@boring\//, "fastify", "zod"],
})
