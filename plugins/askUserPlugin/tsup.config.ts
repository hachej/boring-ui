import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    front: "front/index.tsx",
    server: "server/index.ts",
    shared: "shared/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  external: [
    "@hachej/boring-ui-kit",
    "@hachej/boring-workspace",
    "@hachej/boring-workspace/server",
    "fastify",
    "lucide-react",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "zod",
  ],
})
