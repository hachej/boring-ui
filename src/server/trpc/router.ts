/**
 * Root tRPC router — combines all domain routers.
 * Stub — implementation grows as domain services are ported.
 */
import { initTRPC } from '@trpc/server'
import type { TRPCContext } from './context.js'

const t = initTRPC.context<TRPCContext>().create()

export const router = t.router
export const publicProcedure = t.procedure

// Root router — will be extended with domain sub-routers
export const appRouter = router({})

export type AppRouter = typeof appRouter
