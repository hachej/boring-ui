// The agent playground is launched through server.ts so it can boot the
// Fastify agent API and proxy /api to it. This file exists only so editors
// and Vite-aware tooling find a local config.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
