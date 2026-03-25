import { describe, it, expect } from 'vitest'

describe('tRPC client setup', () => {
  it('exports trpc hooks', async () => {
    const mod = await import('../utils/trpc')
    expect(mod.trpc).toBeDefined()
    expect(typeof mod.trpc.useContext).toBe('function')
    expect(typeof mod.createTrpcClient).toBe('function')
  })

  it('exports TRPCProvider component', async () => {
    const mod = await import('../providers/data/trpcProvider')
    expect(mod.TRPCProvider).toBeDefined()
    expect(typeof mod.TRPCProvider).toBe('function')
  })
})
