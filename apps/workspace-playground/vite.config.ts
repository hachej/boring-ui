import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { createBoringAppViteAliases } from "@hachej/boring-core/app/vite"
import { AGENT_API_PORT, VITE_PORT, startPlaygroundServer } from "./src/server/dev"

const baseResolve = createBoringAppViteAliases({ appRoot: __dirname })
// The playground is the standalone dev surface for the workspace
// package — its src/ contains `@/` (workspace-src-rooted) imports that
// the standard helper doesn't cover. Add those alongside the shared
// aliases.
const playgroundOnlyAliases = [
  // Keep app code importing the public package CSS subpath, but point the
  // playground's local monorepo dev server at the built CSS artifact so Vite
  // serves it as text/css instead of falling back through HTML history.
  { find: "@hachej/boring-workspace/globals.css", replacement: resolve(__dirname, "../../packages/workspace/dist/workspace.css") },
  { find: "@/", replacement: resolve(__dirname, "../../packages/workspace/src") + "/" },
  { find: "@", replacement: resolve(__dirname, "../../packages/workspace/src") },
]

// The playground is the standalone dev surface for @hachej/boring-workspace.
// Backend is the agent package's Fastify app — same one production uses —
// so the file tree, file editor, and agent chat all hit the SAME paths
// against the SAME filesystem. No mock API.
//
// Workspace layout:
//   src/fixtures/  — committed seed content (reference, read-only)
//   workspace/     — gitignored runtime root the agent reads/writes/edits
//
// On dev start we seed `workspace/` from `src/fixtures/` if it's empty,
// so a fresh clone has demo content. Agent edits land in `workspace/`
// without dirtying the committed fixtures. Delete the directory to
// reset; the next boot re-seeds it.

const dynamicPluginReactRefreshExclude = [
  // Runtime/app-authored plugins are loaded through the boring-ui plugin
  // bridge, not React Refresh. Refresh instrumentation can create a
  // second/stale hook dispatcher for dynamically imported panels after edits,
  // so leave these files to Vite's plain esbuild TSX transform and apply
  // updates only after /reload.
  /workspace\/\.pi\/extensions\//,
  /apps\/workspace-playground\/src\/plugins\/[^/]+\/front\//,
  /plugins\/[^/]+\/dist\/front\//,
  // The playground consumes prebuilt workspace/agent/ui dist files. Dynamic
  // plugin imports can pull the same dist modules through timestamped /@fs
  // URLs; React Refresh treats those duplicate module ids as hot updates and
  // can interrupt a hard refresh before the file tree/model/plugin requests
  // settle. Dist bundles are already built artifacts, so don't instrument them.
  /packages\/(workspace|agent|ui)\/dist\//,
]

export default defineConfig({
  plugins: [
    react({
      exclude: dynamicPluginReactRefreshExclude,
    }),
    tailwindcss(),
    {
      name: "boring-agent-backend",
      async configureServer() {
        await startPlaygroundServer()
      },
    },
    {
      name: "boring-runtime-extension-hmr-boundary",
      handleHotUpdate(ctx) {
        // Runtime-authored plugins are reloaded through /reload + the
        // agent-plugin SSE bridge. Letting Vite HMR handle these files causes
        // full page reloads because dynamically imported .pi extension modules
        // are not stable React HMR boundaries.
        if (ctx.file.includes("/workspace/.pi/extensions/")) return []
        return undefined
      },
    },
  ],
  resolve: {
    alias: [...baseResolve.alias, ...playgroundOnlyAliases],
    dedupe: baseResolve.dedupe,
  },
  server: {
    port: VITE_PORT,
    host: true,
    proxy: {
      // All API traffic goes to the agent server — the agent owns the
      // filesystem and the UI bridge. No vite-side mocks.
      "/api/v1": `http://127.0.0.1:${AGENT_API_PORT}`,
    },
  },
})
