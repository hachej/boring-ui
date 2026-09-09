import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proofRoot = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(process.env.PROOF_TARGET_ROOT ?? path.resolve(proofRoot, '../../../..'))
const fixture = path.join(proofRoot, 'fixture')

export default defineConfig({
  root: fixture,
  plugins: [react()],
  resolve: {
    alias: {
      '@proof-chat-panel': path.join(target, 'packages/agent/src/front/chat/PiChatPanel.tsx'),
      '@proof-error-codes': path.join(target, 'packages/agent/src/shared/error-codes.ts'),
      '@proof-agent-styles': path.join(target, 'packages/agent/src/front/styles/globals.css'),
    },
  },
  server: { host: '127.0.0.1', strictPort: true },
})
