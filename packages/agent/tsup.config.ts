import { defineConfig } from "tsup";
import { spawnSync } from "node:child_process";

const EXTERNALS = ["react", "react-dom", "node:sqlite"];
const DEV_BUNDLE_EXTERNALS = ["@vitejs/plugin-react", "@babel/core", "vitest"];

// dist/front/styles.css is produced by a separate PostCSS/Tailwind script
// (scripts/build-front-css.mjs), not by tsup itself. tsup's `clean: true`
// wipes the whole dist/ dir first, so any bare `tsup` invocation (JS-only
// rebuild, watch mode, etc.) silently deletes styles.css unless we
// regenerate it here. Mirrors the onSuccess CSS-copy idiom in
// packages/core/tsup.config.ts.
function buildFrontCss() {
  const result = spawnSync(process.execPath, ["./scripts/build-front-css.mjs"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("build-front-css.mjs failed");
  }
}

export default defineConfig({
  entry: {
    "shared/index": "src/shared/index.ts",
    "core/index": "src/core/index.ts",
    "server/index": "src/server/index.ts",
    "server/pi-session-readability": "src/server/harness/pi-coding-agent/sessionReadability.ts",
    "server/agent-host/testing/gatewayConformance": "src/server/agent-host/testing/gatewayConformance.ts",
    "server/agent-host/testing/compositionRouteProof": "src/server/agent-host/testing/compositionRouteProof.ts",
    "server/worker/index": "src/server/worker/index.ts",
    "front/index": "src/front/index.ts",
    "front/artifacts": "src/front/artifacts.ts",
    "eval/index": "src/eval/index.ts",
  },
  format: ["esm"],
  dts: { resolve: ['@hachej/boring-ui-kit'] },
  splitting: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
  removeNodeProtocol: false,
  external: [...EXTERNALS, ...DEV_BUNDLE_EXTERNALS],
  async onSuccess() {
    buildFrontCss();
  },
});
