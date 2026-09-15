import { createFileRoute } from "@tanstack/react-router"

/** Liveness probe used by verify.sh and by the playground. */
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        }),
    },
  },
})
