import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import fastifyStatic from "@fastify/static"
import { buildServer } from "./index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const { app, port, host } = await buildServer()

  // Serve Vite-built frontend. In the Docker image the dist is at
  // apps/boring-macro-v2/dist/ relative to /app. Fall back gracefully when
  // the dist isn't present (e.g. local dev without a prior build:web run).
  const staticDir = process.env.BORING_UI_STATIC_DIR
    ?? join(__dirname, "../../dist")
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: "/",
      // Let API routes take priority; fall through to index.html for SPA navigation.
      wildcard: false,
    })
    // SPA fallback: unknown GET routes serve index.html
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html", staticDir)
    })
  }

  await app.listen({ port, host })
  app.log.info(`boring.macro on :${port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
