import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { AGENT_API_PORT, VITE_PORT, startPlaygroundServer } from "./src/server/dev"

const useLocalPackages = process.env.BORING_USE_LOCAL_PACKAGES === "1"
const reactSingletonAliases = [
  { find: /^react$/, replacement: resolve(__dirname, "node_modules/react") },
  { find: /^react-dom$/, replacement: resolve(__dirname, "node_modules/react-dom") },
  { find: /^react-dom\/client$/, replacement: resolve(__dirname, "node_modules/react-dom/client.js") },
  { find: /^react\/jsx-runtime$/, replacement: resolve(__dirname, "node_modules/react/jsx-runtime.js") },
  { find: /^react\/jsx-dev-runtime$/, replacement: resolve(__dirname, "node_modules/react/jsx-dev-runtime.js") },
]
const localWorkspaceAlias = [
  { find: "@hachej/boring-workspace/globals.css", replacement: resolve(__dirname, "../../packages/workspace/src/globals.css") },
  { find: /^@hachej\/boring-workspace\/shared$/, replacement: resolve(__dirname, "../../packages/workspace/src/shared/index.ts") },
  { find: /^@hachej\/boring-workspace\/app\/front$/, replacement: resolve(__dirname, "../../packages/workspace/src/app/front/index.ts") },
  { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: resolve(__dirname, "../../packages/workspace/src/app/server/index.ts") },
  { find: /^@hachej\/boring-workspace\/server$/, replacement: resolve(__dirname, "../../packages/workspace/src/server/index.ts") },
  { find: /^@hachej\/boring-workspace\/testing$/, replacement: resolve(__dirname, "../../packages/workspace/src/front/testing/index.ts") },
  { find: /^@hachej\/boring-workspace$/, replacement: resolve(__dirname, "../../packages/workspace/src/index.ts") },
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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "boring-agent-backend",
      async configureServer() {
        await startPlaygroundServer()
      },
    },
  ],
  resolve: {
    alias: useLocalPackages ? [...reactSingletonAliases, ...localWorkspaceAlias] : reactSingletonAliases,
    dedupe: ["react", "react-dom"],
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
