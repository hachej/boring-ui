import type { ComponentType } from "react"
import type { PanelConfig, PaneProps } from "../types/panel"
import type { SurfaceOpenRequest, SurfacePanelResolution } from "../types/surface"
import { defineFrontPlugin, PluginError, type WorkspaceFrontPlugin } from "./defineFrontPlugin"
import type {
  CatalogConfig,
  LeftTabParams,
  PluginBinding,
  PluginOutput,
  PluginProvider,
} from "./types"

export interface BoringFrontPanelRegistration<T = unknown> {
  id: string
  component: ComponentType<PaneProps<T>> | (() => Promise<{ default: ComponentType<PaneProps<T>> }>)
  label?: string
  icon?: ComponentType<{ className?: string }>
  placement?: string
  requiresCapabilities?: string[]
  essential?: boolean
  lazy?: boolean
  chromeless?: boolean
  source?: string
}

export interface BoringFrontPanelCommandRegistration {
  id: string
  title: string
  panelId: string
  run?: () => void
}

export interface BoringFrontLeftTabRegistration<T = LeftTabParams> {
  id: string
  title: string
  panelId: string
  icon?: ComponentType<{ className?: string }>
  component?: PanelConfig<T>["component"]
  lazy?: boolean
  chromeless?: boolean
  requiresCapabilities?: string[]
  source?: string
}

export interface BoringFrontProviderRegistration {
  id: string
  component: PluginProvider
}

export interface BoringFrontBindingRegistration {
  id: string
  component: PluginBinding
}

export interface BoringFrontSurfaceResolverRegistration {
  id?: string
  kind: string
  source?: string
  resolve: (request: SurfaceOpenRequest) => SurfacePanelResolution | null | undefined
}

export interface BoringFrontAPI {
  registerProvider(registration: BoringFrontProviderRegistration): void
  registerBinding(registration: BoringFrontBindingRegistration): void
  registerCatalog(registration: CatalogConfig): void
  registerPanel<T = unknown>(registration: BoringFrontPanelRegistration<T>): void
  registerPanelCommand(registration: BoringFrontPanelCommandRegistration): void
  registerLeftTab<T = LeftTabParams>(registration: BoringFrontLeftTabRegistration<T>): void
  registerSurfaceResolver(registration: BoringFrontSurfaceResolverRegistration): void
}

export type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>
export type BoringFrontSetup = (api: BoringFrontAPI) => void

type RejectAsyncSetup<C> = C extends { setup?: infer Setup }
  ? Setup extends (...args: any[]) => infer Return
    ? Extract<Return, PromiseLike<unknown>> extends never
      ? unknown
      : never
    : unknown
  : unknown

/**
 * A `BoringFrontFactory` that carries its own plugin id (and optional
 * label) as static properties. Lets the workspace shell accept a bare
 * factory in `plugins[]` without requiring the consumer to normalize it
 * manually at the call site.
 *
 * Produced by `definePlugin({ id, ... })`.
 */
export type BoringFrontFactoryWithId = BoringFrontFactory & {
  pluginId: string
  pluginLabel?: string
}

/**
 * Input shapes accepted by `WorkspaceProvider.plugins`:
 * - Internal/static `WorkspaceFrontPlugin` objects used by built-in plugins.
 * - Public `BoringFrontFactoryWithId` entries produced by
 *   `definePlugin({ id, ... })` from `@hachej/boring-workspace/plugin`.
 *
 * The shell normalizes via `toWorkspacePlugin` at the boundary.
 */
export type WorkspaceFrontPluginInput = WorkspaceFrontPlugin | BoringFrontFactoryWithId

/**
 * Declarative plugin config — the canonical shape for `definePlugin`.
 *
 * Each `<thing>s` field is an array of registration objects matching the
 * same shape `api.register<Thing>(...)` accepts. The plugin runtime loops
 * through each non-empty field and calls the corresponding `api.register*`
 * method internally — composition is just JS spread + concat.
 *
 *   definePlugin({
 *     id: "my-plugin",
 *     label: "My Plugin",
 *     panels: [{ id: "my-plugin.panel", label: "My Plugin", component: MyPane }],
 *     commands: [{ id: "my-plugin.open", title: "Open My Plugin", panelId: "my-plugin.panel" }],
 *   })
 *
 * The optional `setup(api)` escape hatch is called LAST, after all
 * declarative registrations. Use only for conditional registration or
 * runtime branching that the declarative fields can't express.
 */
export interface DefinePluginConfig {
  id: string
  label?: string
  panels?: ReadonlyArray<BoringFrontPanelRegistration<any>>
  commands?: ReadonlyArray<BoringFrontPanelCommandRegistration>
  leftTabs?: ReadonlyArray<BoringFrontLeftTabRegistration<any>>
  surfaceResolvers?: ReadonlyArray<BoringFrontSurfaceResolverRegistration>
  providers?: ReadonlyArray<BoringFrontProviderRegistration>
  bindings?: ReadonlyArray<BoringFrontBindingRegistration>
  catalogs?: ReadonlyArray<CatalogConfig>
  /**
   * Escape hatch for registrations that can't be expressed
   * declaratively (conditional, runtime-branched, etc.). Called LAST,
   * after every declarative field has been registered.
   */
  setup?: BoringFrontSetup
}

/**
 * Define a boring-ui plugin. Takes a single declarative config object:
 *
 *   export default definePlugin({
 *     id: "my-plugin",
 *     label: "My Plugin",
 *     panels: [{ id: "my-plugin.panel", label: "My Plugin", component: MyPane }],
 *     commands: [{ id: "my-plugin.open", title: "Open My Plugin", panelId: "my-plugin.panel" }],
 *     // setup: (api) => { ... }  // escape hatch for runtime branching
 *   })
 *
 * Returns a `BoringFrontFactoryWithId` — a function carrying `pluginId`
 * (and optional `pluginLabel`) as static fields. Pass directly to
 * `WorkspaceProvider.plugins`; the workspace's bootstrap normalizes
 * it via `toWorkspacePlugin`.
 *
 * Older positional signatures are not supported. The `setup` field is
 * synchronous so statically composed plugins cannot return a Promise
 * during provider bootstrap.
 */
export function definePlugin<const Config extends DefinePluginConfig>(
  config: Config & RejectAsyncSetup<Config>,
): BoringFrontFactoryWithId {
  if (typeof config !== "object" || config === null) {
    // Soft guard for the common "I used the old form" mistake — make the
    // failure message tell the agent/dev what to switch to instead of
    // throwing a confusing TS-only type error at call time.
    if (typeof config === "string" || typeof config === "function") {
      throw new Error(
        "definePlugin now takes a single declarative config object: " +
          "definePlugin({ id, label?, panels, commands, leftTabs, surfaceResolvers, setup? }). " +
          "The legacy positional form was removed — use the new shape.",
      )
    }
    throw new Error("definePlugin: expected a config object")
  }
  if (typeof config.id !== "string" || config.id.length === 0) {
    throw new Error("definePlugin: `id` is required and must be a non-empty string")
  }
  const factory: BoringFrontFactory = (api) => {
    for (const panel of config.panels ?? []) api.registerPanel(panel)
    for (const command of config.commands ?? []) api.registerPanelCommand(command)
    for (const tab of config.leftTabs ?? []) api.registerLeftTab(tab)
    for (const resolver of config.surfaceResolvers ?? []) api.registerSurfaceResolver(resolver)
    for (const provider of config.providers ?? []) api.registerProvider(provider)
    for (const binding of config.bindings ?? []) api.registerBinding(binding)
    for (const catalog of config.catalogs ?? []) api.registerCatalog(catalog)
    if (config.setup) config.setup(api)
    return undefined
  }
  return brandFactoryWithPluginId(config.id, factory, { label: config.label })
}

/**
 * Internal — wraps an existing BoringFrontFactory with pluginId/pluginLabel
 * static metadata. Public consumers must go through `definePlugin(config)`;
 * this helper exists only so the declarative path can synthesize a
 * factory and then brand it.
 *
 * @internal
 */
function brandFactoryWithPluginId(
  id: string,
  factory: BoringFrontFactory,
  options: { label?: string },
): BoringFrontFactoryWithId {
  const existing = (factory as Partial<BoringFrontFactoryWithId>).pluginId
  if (existing !== undefined && existing !== id) {
    throw new Error(`definePlugin: factory already branded as "${existing}", cannot rebrand as "${id}"`)
  }
  const wrapper = ((api) => factory(api)) as BoringFrontFactoryWithId
  Object.defineProperty(wrapper, "pluginId", { value: id, enumerable: true })
  if (options.label !== undefined) {
    Object.defineProperty(wrapper, "pluginLabel", { value: options.label, enumerable: true })
  }
  return wrapper
}

/**
 * Type guard: is this entry a `BoringFrontFactoryWithId`?
 */
function isBoringFrontFactoryWithId(input: unknown): input is BoringFrontFactoryWithId {
  return typeof input === "function" && typeof (input as BoringFrontFactoryWithId).pluginId === "string"
}

/**
 * Normalize an input entry (internal plugin object or public
 * `BoringFrontFactoryWithId`) into a `WorkspaceFrontPlugin` ready for
 * bootstrap. Factory entries are wrapped via `boringFrontFactoryToPlugin`
 * using the attached metadata.
 */
export function toWorkspacePlugin(input: WorkspaceFrontPluginInput): WorkspaceFrontPlugin {
  if (isBoringFrontFactoryWithId(input)) {
    return boringFrontFactoryToPlugin(input.pluginId, input, {
      ...(input.pluginLabel !== undefined ? { label: input.pluginLabel } : {}),
    })
  }
  if (typeof input === "function") {
    throw new Error(
      "WorkspaceProvider.plugins received a bare BoringFrontFactory without a pluginId. " +
        "Wrap it with `definePlugin({ id, label?, setup: factory })` before passing it in.",
    )
  }
  return input
}

export interface CapturedBoringFrontRegistrations {
  providers: BoringFrontProviderRegistration[]
  bindings: BoringFrontBindingRegistration[]
  catalogs: CatalogConfig[]
  panels: BoringFrontPanelRegistration<any>[]
  panelCommands: BoringFrontPanelCommandRegistration[]
  leftTabs: BoringFrontLeftTabRegistration<any>[]
  surfaceResolvers: BoringFrontSurfaceResolverRegistration[]
  outputs: PluginOutput[]
}

export interface CapturingBoringFrontAPIHandle extends BoringFrontAPI {
  flush(): CapturedBoringFrontRegistrations
}

function clone<T>(items: T[]): T[] {
  return [...items]
}

export function createCapturingBoringFrontAPI(options: { pluginId?: string } = {}): CapturingBoringFrontAPIHandle {
  const providers: BoringFrontProviderRegistration[] = []
  const bindings: BoringFrontBindingRegistration[] = []
  const catalogs: CatalogConfig[] = []
  const panels: BoringFrontPanelRegistration<any>[] = []
  const panelCommands: BoringFrontPanelCommandRegistration[] = []
  const leftTabs: BoringFrontLeftTabRegistration<any>[] = []
  const surfaceResolvers: BoringFrontSurfaceResolverRegistration[] = []
  const outputs: PluginOutput[] = []
  // Intra-plugin id collision detection (DESIGN.md §6.7): two register*
  // calls in the same factory chain landing the same id are silent
  // last-write-wins in the atomic-replace path (same pluginId → no
  // collision warning from replaceByPluginId). Catch them at capture
  // time so factory-chaining mistakes (two kits both registering panel
  // "table") surface immediately with a clear error.
  const seen = new Map<string, string>()
  const claim = (kind: string, id: string) => {
    const key = `${kind}:${id}`
    const prior = seen.get(key)
    if (prior !== undefined) {
      const owner = options.pluginId ?? "<plugin>"
      throw new PluginError(
        "duplicate-id",
        `plugin "${owner}" registers ${kind} "${id}" twice (first as ${prior}, then again). ` +
          `If you are composing kits, two of them are registering the same id — namespace one of them.`,
      )
    }
    seen.set(key, `${kind} "${id}"`)
  }

  return {
    registerProvider(registration) {
      claim("provider", registration.id)
      providers.push(registration)
      outputs.push({ type: "provider", id: registration.id, component: registration.component })
    },
    registerBinding(registration) {
      claim("binding", registration.id)
      bindings.push(registration)
      outputs.push({ type: "binding", id: registration.id, component: registration.component })
    },
    registerCatalog(registration) {
      claim("catalog", registration.id)
      catalogs.push(registration)
      outputs.push({ type: "catalog", catalog: registration })
    },
    registerPanel(registration) {
      claim("panel", registration.id)
      panels.push(registration)
      outputs.push(panelOutput(registration))
    },
    registerPanelCommand(registration) {
      claim("command", registration.id)
      panelCommands.push(registration)
      outputs.push(commandOutput(registration))
    },
    registerLeftTab(registration) {
      claim("left-tab", registration.id)
      leftTabs.push(registration)
      outputs.push(leftTabOutput(registration))
    },
    registerSurfaceResolver(registration) {
      const id = registration.id ?? `${options.pluginId ?? "anon"}:${registration.kind}`
      claim("surface-resolver", id)
      surfaceResolvers.push(registration)
      outputs.push(resolverOutput(registration, options.pluginId))
    },
    flush() {
      return {
        providers: clone(providers),
        bindings: clone(bindings),
        catalogs: clone(catalogs),
        panels: clone(panels),
        panelCommands: clone(panelCommands),
        leftTabs: clone(leftTabs),
        surfaceResolvers: clone(surfaceResolvers),
        outputs: clone(outputs),
      }
    },
  }
}

function panelOutput(panel: BoringFrontPanelRegistration<any>): PluginOutput {
  return {
    type: "panel",
    panel: {
      id: panel.id,
      title: panel.label ?? panel.id,
      component: panel.component,
      ...(panel.icon ? { icon: panel.icon } : {}),
      ...(panel.placement !== undefined ? { placement: panel.placement } : { placement: "center" }),
      ...(panel.requiresCapabilities !== undefined ? { requiresCapabilities: panel.requiresCapabilities } : {}),
      ...(panel.essential !== undefined ? { essential: panel.essential } : {}),
      ...(panel.lazy !== undefined ? { lazy: panel.lazy } : {}),
      ...(panel.chromeless !== undefined ? { chromeless: panel.chromeless } : {}),
      source: panel.source ?? "plugin",
    },
  }
}

function leftTabOutput(tab: BoringFrontLeftTabRegistration<any>): PluginOutput {
  return {
    type: "left-tab",
    id: tab.id,
    title: tab.title,
    component: tab.component ?? (() => null),
    ...(tab.icon ? { icon: tab.icon } : {}),
    ...(tab.lazy !== undefined ? { lazy: tab.lazy } : {}),
    ...(tab.chromeless !== undefined ? { chromeless: tab.chromeless } : {}),
    ...(tab.requiresCapabilities !== undefined ? { requiresCapabilities: tab.requiresCapabilities } : {}),
    source: tab.source ?? "plugin",
  }
}

function commandOutput(command: BoringFrontPanelCommandRegistration): PluginOutput {
  return {
    type: "command",
    command: {
      id: command.id,
      title: command.title,
      run: command.run ?? (() => undefined),
      keywords: [command.panelId],
    },
  }
}

function resolverOutput(resolver: BoringFrontSurfaceResolverRegistration, pluginId?: string): PluginOutput {
  return {
    type: "surface-resolver",
    resolver: {
      id: resolver.id ?? (pluginId ? `${pluginId}:${resolver.kind}` : resolver.kind),
      source: resolver.source ?? "plugin",
      resolve(request) {
        if (request.kind !== resolver.kind) return undefined
        return resolver.resolve(request) ?? undefined
      },
    },
  }
}

export interface BoringFrontFactoryToPluginOptions {
  label?: string
}

export function boringFrontFactoryToPlugin(
  id: string,
  factory: BoringFrontFactory,
  options: BoringFrontFactoryToPluginOptions = {},
): WorkspaceFrontPlugin {
  const api = createCapturingBoringFrontAPI({ pluginId: id })
  const result = factory(api)
  if (result && typeof (result as Promise<void>).then === "function") {
    throw new Error(`boringFrontFactoryToPlugin(${id}) requires a synchronous factory`)
  }

  const captured = api.flush()
  return defineFrontPlugin({
    id,
    ...(options.label ? { label: options.label } : {}),
    outputs: captured.outputs,
  })
}
