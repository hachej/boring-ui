import { defineConfig } from "tsup"

export default defineConfig({
  format: ["esm"],
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
  entry: {
    "front/descriptor": "src/front/descriptor.tsx",
  },
  splitting: true,
  clean: false,
})
