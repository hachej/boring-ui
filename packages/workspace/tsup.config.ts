import { defineConfig } from "tsup"

const PEER_EXTERNALS = ["react", "react-dom", "react/jsx-runtime"]

export default defineConfig({
  entry: {
    "app-server": "src/app/server/index.ts",
    server: "src/server/index.ts",
    shared: "src/shared/index.ts",
    events: "src/front/events/index.ts",
  },
  format: ["esm"],
  dts: {
    resolve: false,
    entry: {
      "app-server": "src/app/server/index.ts",
      server: "src/server/index.ts",
      shared: "src/shared/index.ts",
      events: "src/front/events/index.ts",
    },
  },
  tsconfig: "tsconfig.tsup.json",
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral",
  external: [...PEER_EXTERNALS, /^@boring\//, "fastify", "zod"],
})
