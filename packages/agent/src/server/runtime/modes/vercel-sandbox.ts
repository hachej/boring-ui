import type { RuntimeModeAdapter } from '../mode'

export const vercelSandboxModeAdapter: RuntimeModeAdapter = {
  id: 'vercel-sandbox',
  async create() {
    throw new Error(
      'vercel-sandbox mode is not available in M1 (ships in M2)',
    )
  },
}
