import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"

export default defineConfig({
  root: resolve(import.meta.dirname, "fixture"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5460,
    strictPort: true,
    proxy: {
      "/owners/alice/workspace": "http://127.0.0.1:5470",
    },
  },
})
