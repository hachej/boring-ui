import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.tsx",
    "server/index": "src/server/index.ts",
    "shared/index": "src/shared/index.ts",
    "testing/index": "src/testing/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  external: [
    /^@hachej\/boring-/,
    "fastify",
    "lucide-react",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "zod",
    /^node:/,
  ],
})
