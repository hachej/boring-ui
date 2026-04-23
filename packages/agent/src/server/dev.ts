import Fastify from "fastify";

export async function startDevServer(port = 0) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  const address = await app.listen({ port, host: "0.0.0.0" });
  return { app, address };
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("/dev.ts") || process.argv[1].endsWith("/dev.js"))
) {
  startDevServer(3001).then(({ address }) => {
    console.log(`@boring/agent dev server listening at ${address}`);
  });
}
