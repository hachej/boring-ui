/**
 * Child app tRPC router merging.
 *
 * Child apps define tRPC routers and register them via boring.app.toml:
 *   [backend]
 *   routers = ['src/server/routers/analytics:analyticsRouter']
 *
 * At startup, these routers are dynamically imported and merged into the
 * root tRPC router under a namespace: /trpc/x/<name>.*
 *
 * Child apps import { router, workspaceProcedure } from 'boring-ui/trpc'
 * to get auth + workspace context for free.
 */
import { type AnyRouter } from '@trpc/server'
import { router } from './router.js'

export interface ChildRouterEntry {
  /** Namespace name (derived from module path or explicit) */
  name: string
  /** The tRPC router instance */
  router: AnyRouter
}

/**
 * Parse a router path string (module:export format) into components.
 *
 * Format: 'path/to/module:exportName'
 * Example: 'src/server/routers/analytics:analyticsRouter'
 *
 * Returns { modulePath, exportName, namespaceName }
 */
export function parseRouterPath(routerPath: string): {
  modulePath: string
  exportName: string
  namespaceName: string
} {
  const parts = routerPath.split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid router path "${routerPath}". Expected format: 'module/path:exportName'`,
    )
  }

  const [modulePath, exportName] = parts
  // Derive namespace from module path: 'src/server/routers/analytics' -> 'analytics'
  const segments = modulePath.replace(/\\/g, '/').split('/')
  const namespaceName = segments[segments.length - 1].replace(/\.(ts|js|mjs)$/, '')

  return { modulePath, exportName, namespaceName }
}

/**
 * Dynamically load a child app router from a module:export path.
 */
export async function loadChildRouter(
  routerPath: string,
  projectRoot: string,
): Promise<ChildRouterEntry> {
  const { modulePath, exportName, namespaceName } = parseRouterPath(routerPath)

  // Resolve relative to project root
  const fullPath = modulePath.startsWith('/')
    ? modulePath
    : `${projectRoot}/${modulePath}`

  try {
    const mod = await import(fullPath)
    const childRouter = mod[exportName]

    if (!childRouter) {
      throw new Error(
        `Export "${exportName}" not found in module "${modulePath}"`,
      )
    }

    return { name: namespaceName, router: childRouter }
  } catch (err: any) {
    throw new Error(
      `Failed to load child router "${routerPath}": ${err.message}`,
    )
  }
}

/**
 * Merge child app routers into a combined router.
 *
 * The result is a router with child routers namespaced as properties:
 *   appRouter.analytics.listEvents()
 *   appRouter.macro.runPipeline()
 *
 * @param childRouters - Array of loaded child router entries
 * @returns A merged tRPC router
 */
export function mergeChildRouters(childRouters: ChildRouterEntry[]) {
  const routerMap: Record<string, AnyRouter> = {}

  for (const entry of childRouters) {
    if (routerMap[entry.name]) {
      throw new Error(
        `Duplicate child router namespace "${entry.name}". ` +
        `Each child app router must have a unique namespace.`,
      )
    }
    routerMap[entry.name] = entry.router
  }

  // Create merged router with child routers as sub-routers
  return router(routerMap)
}
