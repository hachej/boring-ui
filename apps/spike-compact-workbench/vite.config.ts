import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Throwaway spike: frontend only, no backend, no proxy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.SPIKE_PORT ?? 5477),
    strictPort: true,
  },
})
