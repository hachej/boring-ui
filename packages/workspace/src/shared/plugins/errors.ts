export type PluginErrorKind = "duplicate-id" | "validation" | "runtime"

export class PluginError extends Error {
  constructor(
    public readonly kind: PluginErrorKind,
    message: string,
  ) {
    super(message)
    this.name = "PluginError"
  }
}
