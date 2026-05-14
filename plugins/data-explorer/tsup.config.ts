import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    "front/index": "src/front/index.ts",
    "shared/index": "src/shared/index.ts",
    "testing/index": "src/testing/index.ts",
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
    "@hachej/boring-ui-kit",
    "lucide-react",
    "clsx",
    "tailwind-merge",
  ],
})
