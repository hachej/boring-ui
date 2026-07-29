import { defineConfig } from "tsup"

export default defineConfig({
  entry: { "server/embeddedServerTypes": "src/server/embeddedServerTypes.ts" },
  format: ["esm"],
  target: "node20",
  bundle: false,
  clean: false,
  dts: { only: true },
})
