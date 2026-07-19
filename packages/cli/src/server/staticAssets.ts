import type { FastifyInstance } from "fastify"
import { existsSync } from "node:fs"
import { join } from "node:path"

function ensureFrontendBuilt(publicDir: string) {
  if (existsSync(join(publicDir, "index.html"))) return
  console.error("\nError: boring-ui frontend not found.")
  console.error("Run `pnpm build:full` in packages/cli to build it first.\n")
  process.exit(1)
}

export async function registerStatic(app: FastifyInstance, publicDir: string) {
  ensureFrontendBuilt(publicDir)
  // Compress responses (gzip/brotli) before serving static assets. The front
  // bundle is multi-MB uncompressed; over a remote/tailscale link that raw
  // transfer dominates first-load time. Compression cuts it ~3-4x. Registered
  // before @fastify/static so its onSend hook wraps the file streams.
  const { default: fastifyCompress } = await import("@fastify/compress")
  await app.register(fastifyCompress, { global: true, encodings: ["br", "gzip"], threshold: 1024 })
  const { default: fastifyStatic } = await import("@fastify/static")
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    // @fastify/send writes its own Cache-Control after setHeaders runs, so
    // disable it and set the header explicitly for both cases below.
    cacheControl: false,
    setHeaders(res, filePath) {
      // Vite emits content-hashed filenames under /assets, so they can be
      // cached forever — without this the multi-MB bundle is revalidated
      // (or re-downloaded) on every workspace open. Everything else (notably
      // index.html) keeps max-age=0 + etag so deploys are picked up
      // immediately.
      res.setHeader(
        "cache-control",
        /[\\/]assets[\\/]/.test(filePath)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0",
      )
    },
  })

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" })
    }
    return reply.sendFile("index.html", publicDir)
  })
}
