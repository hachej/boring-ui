/**
 * Which bare specifiers the host — rather than the plugin's own
 * node_modules — provides, and how a bare specifier maps back to one.
 */

const HOST_VIRTUAL_SINGLETON_MODULES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@hachej/boring-workspace",
  "@hachej/boring-workspace/plugin",
  "@hachej/boring-workspace/events",
] as const

export const HOST_SINGLETON_MODULES = HOST_VIRTUAL_SINGLETON_MODULES

export const HOST_PROVIDED_MODULES = [
  ...HOST_SINGLETON_MODULES,
  // Host-provided design-system package. It is resolved via the host Vite
  // alias/dedupe path instead of plugin-local node_modules, but it is not a
  // virtual global singleton because it has many component exports and no
  // React identity/state boundary like React/workspace do.
  "@hachej/boring-ui-kit",
] as const

export type HostVirtualSingletonModule = typeof HOST_SINGLETON_MODULES[number]
export type HostProvidedModule = typeof HOST_PROVIDED_MODULES[number]

export function isHostVirtualSingletonModule(source: string): source is HostVirtualSingletonModule {
  return HOST_VIRTUAL_SINGLETON_MODULES.includes(source as HostVirtualSingletonModule)
}

export function isHostProvidedModule(source: string): source is HostProvidedModule {
  return HOST_PROVIDED_MODULES.includes(source as HostProvidedModule)
}

export function packageNameFromBareSpecifier(source: string): string {
  const parts = source.split("/")
  return source.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]
}

/**
 * True when `source` is a subpath of a host-provided package that the host
 * does not itself provide (e.g. `@hachej/boring-ui-kit/internal`). Such an
 * import would otherwise be served from plugin-local node_modules and load a
 * second copy of a package the host deduplicates.
 */
export function isUnknownHostProvidedSubpath(source: string): boolean {
  if (isHostProvidedModule(source)) return false
  const packageName = packageNameFromBareSpecifier(source)
  return HOST_PROVIDED_MODULES.some((moduleName) => packageNameFromBareSpecifier(moduleName) === packageName)
}
