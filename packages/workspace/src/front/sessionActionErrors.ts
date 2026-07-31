import { toast } from "./toast"

export function surfaceSessionActionError(action: string, error: unknown): void {
  const message = error instanceof Error && error.message
    ? error.message
    : `The ${action.toLowerCase()} request failed.`
  const record = typeof error === "object" && error !== null
    ? error as { code?: unknown; errorCode?: unknown }
    : undefined
  const rawCode = record?.code ?? record?.errorCode
  const code = typeof rawCode === "string" && rawCode.length > 0 ? rawCode : undefined
  toast.error({
    title: `Could not ${action.toLowerCase()}`,
    description: code ? `${message} (${code})` : message,
  })
}
