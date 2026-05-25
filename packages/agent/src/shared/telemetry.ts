export interface TelemetrySink {
  capture(event: TelemetryEvent): void | Promise<void>
  flush?(): void | Promise<void>
}

export interface TelemetryEvent {
  name: string
  distinctId?: string
  properties?: Record<string, unknown>
}

export const noopTelemetry: TelemetrySink = {
  capture() {},
}

export function safeCapture(telemetry: TelemetrySink, event: TelemetryEvent): void {
  try {
    void Promise.resolve(telemetry.capture(event)).catch(() => {})
  } catch {}
}
