/** Boot-order bridge for trusted plugins that are resolved before AgentHost exists. */
export function createDeferredHostCapability<T extends object>(label: string): {
  readonly capability: T
  bind(target: T): void
} {
  let target: T | undefined
  const capability = new Proxy({} as T, {
    get(_object, property) {
      if (!target) throw new Error(`${label} is not ready`)
      const value = Reflect.get(target, property)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return {
    capability,
    bind(next) {
      if (target) throw new Error(`${label} is already bound`)
      target = next
    },
  }
}
