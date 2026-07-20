import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

const port = Number(process.env.PORT ?? "5480")

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "ui-review-fixture-filesystem-events",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith("/api/v1/fs/events")) return next()
          response.writeHead(200, {
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream",
          })
          response.write(": ui-review fixture connected\n\n")
          request.on("close", () => response.end())
        })
      },
    },
  ],
  server: { host: "127.0.0.1", port },
})
