import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { AGENT_API_PORT, VITE_PORT, startPlaygroundServer } from "./src/server/dev"

// The playground is the standalone dev surface for @boring/workspace.
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
    alias: {
      "@boring/workspace/globals.css": resolve(__dirname, "../../packages/workspace/src/globals.css"),
      "@boring/workspace/ui-shadcn": resolve(__dirname, "../../packages/workspace/src/components/ui/index.ts"),
      "@boring/workspace/shared": resolve(__dirname, "../../packages/workspace/src/shared/index.ts"),
      "@boring/workspace/app/front": resolve(__dirname, "../../packages/workspace/src/app/front/index.ts"),
      "@boring/workspace/app/server": resolve(__dirname, "../../packages/workspace/src/app/server/index.ts"),
      "@boring/workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@boring/workspace/testing": resolve(__dirname, "../../packages/workspace/src/testing/index.ts"),
      "@boring/workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
      // Agent: consumed via package exports (dist). Live edits to agent
      // require `pnpm --filter @boring/agent build` + restart. Tried
      // aliasing to src here, but agent's source uses its OWN `@/` alias
      // for internal imports (~23 files like `@/front/lib`) that
      // conflicts with workspace's `@/` alias — vite has one global `@`,
      // so they can't coexist. Stay on dist for now.
      "@/": resolve(__dirname, "../../packages/workspace/src") + "/",
      "@": resolve(__dirname, "../../packages/workspace/src"),
    },
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
