import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";

export async function startDevServer(port = 0) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  app.all("/api/v1/*", async (_req, reply) => {
    reply.code(501).send({ error: "Not Implemented" });
  });

  const address = await app.listen({ port, host: "0.0.0.0" });
  return { app, address };
}

async function startViteDevServer() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(thisDir, "..", "..", "app");

  const vite = await createViteServer({
    root: appRoot,
    plugins: [react()],
    server: { port: 5180, strictPort: false },
  });
  await vite.listen();
  vite.printUrls();
  return vite;
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("/dev.ts") || process.argv[1].endsWith("/dev.js"))
) {
  const [{ app, address }] = await Promise.all([
    startDevServer(0),
    startViteDevServer(),
  ]);
  app.log.info(`@boring/agent dev server listening at ${address}`);
}
