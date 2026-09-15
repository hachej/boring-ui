import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Framed by the playground stage, so the dev server must answer on loopback
// and must not refuse the embedding host header.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.SAMPLE_APP_PORT ?? 5321),
    strictPort: true,
    host: '127.0.0.1',
  },
})
