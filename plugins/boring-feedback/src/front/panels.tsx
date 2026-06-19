import { useMemo, useState } from "react"
import type { PaneProps } from "@hachej/boring-workspace"
import { BORING_FEEDBACK_PANEL_ID } from "../shared/constants"
import type { BoringFeedbackParams } from "../shared/types"

export function BoringFeedbackPanel({ params }: PaneProps<BoringFeedbackParams>) {
  const panelParams = params ?? {}
  const [report, setReport] = useState(panelParams.report ?? "")
  const [grillChoice, setGrillChoice] = useState<"now" | "defer" | "skip">("defer")
  const [copied, setCopied] = useState(false)

  const status = grillChoice === "defer" ? "status:needs-grill" : "status:to-triage"
  const commandText = useMemo(() => {
    const trimmed = report.trim()
    return trimmed ? `/feedback ${trimmed}` : "/feedback"
  }, [report])

  async function copyCommand() {
    await globalThis.navigator?.clipboard?.writeText(commandText)
    setCopied(true)
    globalThis.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <header className="border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Feedback</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{panelParams.source ?? "manual"} intake</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded border border-border px-2 py-1 font-mono">{status}</span>
            <span className="rounded border border-border px-2 py-1 font-mono">source:feedback</span>
          </div>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
            Report
            <textarea
              className="min-h-48 w-full resize-y rounded-md border border-border bg-background p-3 text-sm font-normal outline-none transition focus:border-foreground"
              placeholder="What happened?"
              value={report}
              onChange={(event) => setReport(event.target.value)}
            />
          </label>

          <aside className="min-w-0 rounded-md border border-border bg-card p-3">
            <div className="text-sm font-medium">Grill</div>
            <div className="mt-3 grid gap-2">
              {[
                ["now", "Now"],
                ["defer", "Defer"],
                ["skip", "Skip"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                    grillChoice === value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground hover:bg-accent"
                  }`}
                  onClick={() => setGrillChoice(value as "now" | "defer" | "skip")}
                >
                  {label}
                </button>
              ))}
            </div>
          </aside>
        </section>

        <section className="mt-4 rounded-md border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Command</div>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
              onClick={copyCommand}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="max-h-40 overflow-auto rounded bg-background p-3 text-xs">{commandText}</pre>
        </section>
      </div>
    </div>
  )
}
