export interface RuntimeProvisioningSnapshot {
  env?: Record<string, string>
  pathEntries?: string[]
}

export interface RuntimeProvisioningOptions extends RuntimeProvisioningSnapshot {
  getCurrent?: () => RuntimeProvisioningSnapshot | undefined
}

export function mergeRuntimeProvisioningEnv(
  runtime: RuntimeProvisioningOptions | undefined,
  commandEnv: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> | undefined {
  const current = runtime?.getCurrent?.() ?? runtime
  if (!current?.env && !current?.pathEntries?.length) return commandEnv
  const merged: Record<string, string | undefined> = {
    ...(current.env ?? {}),
    ...(commandEnv ?? {}),
  }
  const pathParts = [...(current.pathEntries ?? [])]
  if (current.env?.PATH) pathParts.push(current.env.PATH)
  if (commandEnv?.PATH) pathParts.push(commandEnv.PATH)
  if (pathParts.length > 0) merged.PATH = pathParts.join(':')
  return merged
}
