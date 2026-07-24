import { defineConfig } from "tsup";

const EXTERNALS = ["react", "react-dom"];
const DEV_BUNDLE_EXTERNALS = ["@vitejs/plugin-react", "@babel/core", "vitest"];

export default defineConfig({
  entry: {
    "shared/index": "src/shared/index.ts",
    "core/index": "src/core/index.ts",
    "server/index": "src/server/index.ts",
    "server/pi-session-readability": "src/server/harness/pi-coding-agent/sessionReadability.ts",
    "server/agent-host/testing/gatewayConformance": "src/server/agent-host/testing/gatewayConformance.ts",
    "server/testing/scriptedPiHarness": "src/server/testing/scriptedPiHarness.ts",
    "server/worker/index": "src/server/worker/index.ts",
    "front/index": "src/front/index.ts",
    "eval/index": "src/eval/index.ts",
  },
  format: ["esm"],
  dts: { resolve: ['@hachej/boring-ui-kit'] },
  splitting: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
  external: [...EXTERNALS, ...DEV_BUNDLE_EXTERNALS],
});
