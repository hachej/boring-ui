import { BORING_AUTOMATION_ROUTE_PREFIX, type Automation, type AutomationCreate, type AutomationPatch, type AutomationRun } from "../shared"

export class AutomationClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 0,
  ) {
    super(message)
    this.name = "AutomationClientError"
  }
}

export interface AutomationClientOptions {
  apiBaseUrl?: string
  headers?: Record<string, string>
  onAuthError?: (statusCode: number) => void
  apiTimeout?: number
}

export interface AutomationClientRequestOptions {
  signal?: AbortSignal
}

type ApiOk<T> = T & { ok: true }
type ApiError = { ok?: false; code?: string; error?: string }

function joinUrl(apiBaseUrl: string | undefined, path: string): string {
  const base = apiBaseUrl?.replace(/\/$/, "") ?? ""
  return `${base}${path}`
}

function timeoutReason(timeoutMs: number): Error {
  if (typeof DOMException !== "undefined") return new DOMException(`Automation request timed out after ${timeoutMs}ms`, "TimeoutError")
  return new Error(`Automation request timed out after ${timeoutMs}ms`)
}

function composeRequestSignal(source: AbortSignal | undefined, timeoutMs: number | undefined): {
  signal?: AbortSignal
  cleanup: () => void
  timedOut: () => boolean
} {
  const shouldTimeout = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
  if (!source && !shouldTimeout) return { signal: undefined, cleanup: () => {}, timedOut: () => false }

  const controller = new AbortController()
  let didTimeout = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const abortFromSource = () => controller.abort(source?.reason)

  if (source?.aborted) {
    controller.abort(source.reason)
  } else {
    source?.addEventListener("abort", abortFromSource, { once: true })
  }

  if (shouldTimeout) {
    timeoutId = setTimeout(() => {
      didTimeout = true
      controller.abort(timeoutReason(timeoutMs))
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      source?.removeEventListener("abort", abortFromSource)
    },
    timedOut: () => didTimeout,
  }
}

export function createAutomationClient(options: AutomationClientOptions = {}) {
  async function request<T>(path: string, init: RequestInit = {}, timeoutMs = options.apiTimeout): Promise<T> {
    const headers = {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
      ...(init.headers ?? {}),
    }
    const requestSignal = composeRequestSignal(init.signal ?? undefined, timeoutMs)
    try {
      const response = await fetch(joinUrl(options.apiBaseUrl, `${BORING_AUTOMATION_ROUTE_PREFIX}${path}`), {
        ...init,
        headers,
        signal: requestSignal.signal,
      })
      if (response.status === 204) return undefined as T

      const payload = await response.json().catch(() => ({})) as ApiError | ApiOk<T>
      if (!response.ok || payload.ok === false) {
        if (response.status === 401 || response.status === 403) options.onAuthError?.(response.status)
        throw new AutomationClientError(
          "code" in payload && typeof payload.code === "string" ? payload.code : "BORING_AUTOMATION_ROUTE_ERROR",
          "error" in payload && typeof payload.error === "string" ? payload.error : "Automation request failed",
          response.status,
        )
      }
      return payload as T
    } catch (error) {
      if (requestSignal.timedOut()) {
        throw new AutomationClientError(
          "BORING_AUTOMATION_TIMEOUT",
          `Automation request timed out after ${timeoutMs}ms`,
        )
      }
      throw error
    } finally {
      requestSignal.cleanup()
    }
  }

  return {
    async listAutomations(requestOptions: AutomationClientRequestOptions = {}): Promise<Automation[]> {
      const payload = await request<{ automations: Automation[] }>("/automations", { signal: requestOptions.signal })
      return payload.automations
    },

    async createAutomation(input: AutomationCreate): Promise<Automation> {
      const payload = await request<{ automation: Automation }>("/automations", {
        method: "POST",
        body: JSON.stringify(input),
      })
      return payload.automation
    },

    async getAutomation(id: string, requestOptions: AutomationClientRequestOptions = {}): Promise<Automation> {
      const payload = await request<{ automation: Automation }>(`/automations/${encodeURIComponent(id)}`, { signal: requestOptions.signal })
      return payload.automation
    },

    async updateAutomation(id: string, patch: AutomationPatch): Promise<Automation> {
      const payload = await request<{ automation: Automation }>(`/automations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      return payload.automation
    },

    async deleteAutomation(id: string): Promise<void> {
      await request<void>(`/automations/${encodeURIComponent(id)}`, { method: "DELETE" })
    },

    async getPrompt(id: string, requestOptions: AutomationClientRequestOptions = {}): Promise<string> {
      const payload = await request<{ prompt: string }>(`/automations/${encodeURIComponent(id)}/prompt`, { signal: requestOptions.signal })
      return payload.prompt
    },

    async updatePrompt(id: string, prompt: string): Promise<void> {
      await request<{ ok: true }>(`/automations/${encodeURIComponent(id)}/prompt`, {
        method: "PUT",
        body: JSON.stringify({ prompt }),
      })
    },

    async runNow(id: string): Promise<AutomationRun> {
      const payload = await request<{ run: AutomationRun }>(`/automations/${encodeURIComponent(id)}/run`, { method: "POST" }, 0)
      return payload.run
    },

    async listRuns(id: string, requestOptions: AutomationClientRequestOptions = {}): Promise<AutomationRun[]> {
      const payload = await request<{ runs: AutomationRun[] }>(`/automations/${encodeURIComponent(id)}/runs`, { signal: requestOptions.signal })
      return payload.runs
    },
  }
}

export type AutomationClient = ReturnType<typeof createAutomationClient>
