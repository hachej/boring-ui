import { useEffect, useState } from 'react'

import type { BuilderActivity } from '../shared/stage'

export interface ActivityStripProps {
  readonly builder: BuilderActivity | null
  readonly thinkingStartedAt: number | null
}

export function formatElapsed(startedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return `${hours} hr${remainder ? ` ${remainder} min` : ''}`
}

/** A quiet, non-interactive account of only the work the person is waiting for. */
export function ActivityStrip({ builder, thinkingStartedAt }: ActivityStripProps) {
  const [now, setNow] = useState(() => Date.now())
  const builderStartedAt = builder ? Date.parse(builder.startedAt) : null
  const startedAt = builderStartedAt ?? thinkingStartedAt

  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  if (startedAt === null) return null

  const phrase = builder
    ? builder.milestone === 'started'
      ? `${builder.stage === 'mockup' ? 'Sketching' : 'Building'} your ${builder.label}…`
      : 'Checking it works'
    : 'Thinking…'
  const showElapsed = builder !== null || now - startedAt >= 60_000

  return (
    <div
      className="one-chat-activity"
      data-testid="one-chat-activity"
      role="status"
      aria-live="polite"
    >
      <span className="one-chat-activity-dot" aria-hidden="true" />
      <span>{phrase}</span>
      {showElapsed ? <span className="one-chat-activity-time">· {formatElapsed(startedAt, now)}</span> : null}
    </div>
  )
}
