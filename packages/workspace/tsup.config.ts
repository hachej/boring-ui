import { defineConfig } from "tsup"

const PEER_EXTERNALS = ["react", "react-dom", "react/jsx-runtime"]

export default defineConfig({
  entry: {
    "app-server": "src/app/server/index.ts",
    server: "src/server/index.ts",
    "runtime-server": "src/server/runtimeBackend/defineRuntimeServerPlugin.ts",
    shared: "src/shared/index.ts",
    "bridge-client": "src/bridge-client/index.ts",
    events: "src/front/events/index.ts",
    plugin: "src/plugin.ts",
  },
  format: ["esm"],
  dts: {
    resolve: false,
    entry: {
      "app-server": "src/app/server/index.ts",
        server: "src/server/index.ts",
      "runtime-server": "src/server/runtimeBackend/defineRuntimeServerPlugin.ts",
      shared: "src/shared/index.ts",
      "bridge-client": "src/bridge-client/index.ts",
      events: "src/front/events/index.ts",
      plugin: "src/plugin.ts",
    },
  },
  tsconfig: "tsconfig.tsup.json",
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral",
  external: [
    ...PEER_EXTERNALS,
    /^@boring\//,
    "fastify",
    "zod",
    // Canonical front-ID preflight is server-only; keep its AST parser out of
    // browser-facing and bundled Workspace entrypoints.
    "@babel/parser",
    // Pi is a server-only dep imported by `src/app/server/`. Keep
    // external so Node consumers resolve from their own node_modules;
    // browser bundles never reach the server entry so it doesn't leak.
    "@mariozechner/pi-coding-agent",
    /^@hachej\/boring-ui-plugin-cli(\/.*)?$/,
  ],
})
