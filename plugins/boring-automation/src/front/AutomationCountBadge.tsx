"use client"

import { useEffect, useState } from "react"
import { useAutomationClient } from "./AutomationRuntimeContext"

const REFRESH_INTERVAL_MS = 15_000

export function AutomationCountBadge() {
  const client = useAutomationClient()
  const [{ total, running }, setCounts] = useState({ total: 0, running: 0 })

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const automations = await client.listAutomations()
        const runs = await Promise.all(automations.map(async (automation) => client.listRuns(automation.id)))
        if (cancelled) return
        setCounts({
          total: automations.length,
          running: runs.filter((automationRuns) => automationRuns.some((run) => run.status === "queued" || run.status === "running")).length,
        })
      } catch {
        // The list panel owns request errors; a count failure must not hide its trigger.
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [client])

  if (total === 0) return null
  return (
    <span
      data-boring-workspace-part="app-left-automation-count"
      aria-label={`${running} running automation${running === 1 ? "" : "s"}, ${total} automation${total === 1 ? "" : "s"} created`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm"
    >
      {running}/{total}
    </span>
  )
}
