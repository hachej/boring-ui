import { defineConfig } from "tsup"

const sharedOptions = {
  format: ["esm"] as const,
  dts: true,
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
}

export default defineConfig({
  ...sharedOptions,
  entry: {
    "front/index": "src/front/index.tsx",
    "server/index": "src/server/index.ts",
    "shared/index": "src/shared/index.ts",
    "testing/index": "src/testing/index.ts",
  },
  splitting: false,
  clean: true,
})
