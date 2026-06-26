import { defineRuntimeServerPlugin } from "@hachej/boring-workspace/server"
import { refresh } from "../agent/index"

async function refreshResponse() {
  try {
    const data = await refresh()
    return { ok: true, generatedAt: data.generatedAt, repo: data.repo, prs: data.prs.length, issues: data.issues?.length ?? 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: "response" as const, status: 500, body: { ok: false, error: message } }
  }
}

export default defineRuntimeServerPlugin({
  routes: async (router) => {
    router.post("/api/v1/github-pr-tracker/refresh", refreshResponse)
    router.get("/api/v1/github-pr-tracker/refresh", refreshResponse)
  },
})
