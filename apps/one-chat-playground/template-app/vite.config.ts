import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const port = Number(process.env.PORT ?? 5340)
const host = process.env.HOST ?? "127.0.0.1"

// `allowedHosts: true` so the playground can frame this app from another origin.
const server = { port, host, strictPort: true, allowedHosts: true } as const

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // better-sqlite3 is a native module: keep it out of the SSR bundle.
  ssr: { external: ["better-sqlite3"] },
  server,
  preview: server,
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})
