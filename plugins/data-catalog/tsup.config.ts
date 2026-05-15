import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.tsx",
    "server/index": "src/server/index.ts",
    "shared/index": "src/shared/index.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  target: "es2022",
  platform: "neutral",
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "lucide-react",
    /^@hachej\/boring-data-explorer(\/.*)?$/,
    /^@hachej\/boring-workspace(\/.*)?$/,
  ],
})
