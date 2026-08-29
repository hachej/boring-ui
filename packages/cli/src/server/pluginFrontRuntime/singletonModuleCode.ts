import { isHostVirtualSingletonModule, type HostVirtualSingletonModule } from "./hostModules.js"
import { RUNTIME_SINGLETON_EXPORTS } from "./hostSingletonExports.js"

const RUNTIME_SINGLETON_ID_PREFIX = "\0boring-runtime-singleton:"
const RUNTIME_SINGLETON_GLOBAL = "__BORING_RUNTIME_SINGLETONS__"

const JSX_RUNTIME_SOURCES = new Set<HostVirtualSingletonModule>(["react/jsx-runtime", "react/jsx-dev-runtime"])
const JSX_FACTORY_EXPORTS = new Set(["jsx", "jsxs", "jsxDEV"])

export function virtualSingletonId(source: HostVirtualSingletonModule): string {
  return `${RUNTIME_SINGLETON_ID_PREFIX}${source}`
}

export function sourceFromVirtualSingletonId(id: string): HostVirtualSingletonModule | undefined {
  if (!id.startsWith(RUNTIME_SINGLETON_ID_PREFIX)) return undefined
  const source = id.slice(RUNTIME_SINGLETON_ID_PREFIX.length)
  return isHostVirtualSingletonModule(source) ? source : undefined
}

/**
 * How one export name is read off the host singleton. The JSX runtimes need
 * fallbacks: a React build may ship them as a default-only namespace, or not
 * at all (older automatic-runtime shims), in which case the factory is
 * synthesised from `React.createElement`.
 */
function runtimeSingletonExportExpression(source: HostVirtualSingletonModule, name: string): string {
  const key = JSON.stringify(name)
  if (JSX_RUNTIME_SOURCES.has(source)) {
    if (name === "Fragment") return `(singleton[${key}] ?? singleton.default?.[${key}] ?? singletons?.react?.Fragment)`
    if (JSX_FACTORY_EXPORTS.has(name)) {
      return `(singleton[${key}] ?? singleton.default?.[${key}] ?? ((type, props, key) => singletons.react.createElement(type, key === undefined ? props : { ...props, key })))`
    }
  }
  return `singleton[${key}]`
}

/**
 * Source of the shim module served for a host singleton import. It reads the
 * live host instance off a global so the plugin shares React/workspace
 * identity with the host app instead of loading a second copy.
 */
export function runtimeSingletonModuleCode(source: HostVirtualSingletonModule): string | undefined {
  const exports = RUNTIME_SINGLETON_EXPORTS[source]
  if (!exports) return undefined
  const exportLines = exports.map((name) => `export const ${name} = normalized[${JSON.stringify(name)}];`)
  const normalizedAssignments = exports.map((name) => `  ${JSON.stringify(name)}: ${runtimeSingletonExportExpression(source, name)},`)
  return [
    `const singletons = globalThis[${JSON.stringify(RUNTIME_SINGLETON_GLOBAL)}];`,
    `const singleton = singletons && singletons[${JSON.stringify(source)}];`,
    `if (!singleton) throw new Error(${JSON.stringify(`missing runtime singleton: ${source}`)});`,
    "const normalized = {",
    "  ...singleton,",
    ...normalizedAssignments,
    "};",
    "export default normalized;",
    ...exportLines,
  ].join("\n")
}

/** Code for a singleton source that may not be a virtual singleton at all. */
export function runtimeSingletonModuleCodeFor(source: string): string | undefined {
  return isHostVirtualSingletonModule(source) ? runtimeSingletonModuleCode(source) : undefined
}
