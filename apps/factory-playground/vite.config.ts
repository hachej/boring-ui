import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { createBoringAppViteAliases } from '@hachej/boring-core/app/vite'
import { FACTORY_API_PORT, FACTORY_UI_PORT, startFactoryPlaygroundServer } from './src/server/dev'

const appRoot = import.meta.dirname
const repoRoot = resolve(appRoot, '../..')
const baseResolve = createBoringAppViteAliases({ appRoot })

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'boring-factory-backend',
      async configureServer() {
        await startFactoryPlaygroundServer()
      },
    },
  ],
  resolve: baseResolve,
  server: {
    host: true,
    port: FACTORY_UI_PORT,
    fs: { allow: [repoRoot] },
    proxy: {
      '/api/v1': `http://127.0.0.1:${FACTORY_API_PORT}`,
      '/api/boring-tasks': `http://127.0.0.1:${FACTORY_API_PORT}`,
    },
  },
})
