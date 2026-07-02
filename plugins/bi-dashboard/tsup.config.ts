import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.ts",
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
    "@hachej/boring-workspace/plugin",
    "@hachej/boring-workspace/server",
    "@hachej/boring-ui-kit",
    "@perspective-dev/client",
    "@perspective-dev/client/inline",
    "@perspective-dev/viewer",
    "@perspective-dev/viewer-datagrid",
    "@perspective-dev/viewer-d3fc",
    "lucide-react",
  ],
})
