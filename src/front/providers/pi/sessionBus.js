const PI_SESSION_STATE_EVENT = 'boring-ui:pi-session-state'
const PI_SESSION_SWITCH_EVENT = 'boring-ui:pi-session-switch'
const PI_SESSION_NEW_EVENT = 'boring-ui:pi-session-new'
const PI_SESSION_REQUEST_EVENT = 'boring-ui:pi-session-request'

const eventTarget = () => (typeof window !== 'undefined' ? window : null)
const normalizePanelId = (panelId) => String(panelId || '')

export function publishPiSessionState(panelId, detail) {
  const target = eventTarget()
  if (!target) return
  target.dispatchEvent(
    new CustomEvent(PI_SESSION_STATE_EVENT, {
      detail: {
        panelId: normalizePanelId(panelId),
        state: detail || { currentSessionId: '', sessions: [] },
      },
    }),
  )
}

export function subscribePiSessionState(panelId, listener) {
  const target = eventTarget()
  if (!target) return () => {}
  const normalizedPanelId = normalizePanelId(panelId)

  const handler = (event) => {
    const detail = event.detail || {}
    if (normalizePanelId(detail.panelId) !== normalizedPanelId) return
    listener(detail.state || { currentSessionId: '', sessions: [] })
  }

  target.addEventListener(PI_SESSION_STATE_EVENT, handler)
  return () => target.removeEventListener(PI_SESSION_STATE_EVENT, handler)
}

export function requestPiSessionState(panelId) {
  const target = eventTarget()
  if (!target) return
  target.dispatchEvent(
    new CustomEvent(PI_SESSION_REQUEST_EVENT, {
      detail: { panelId: normalizePanelId(panelId) },
    }),
  )
}

export function requestPiSwitchSession(panelId, sessionId) {
  const target = eventTarget()
  if (!target || !sessionId) return
  target.dispatchEvent(
    new CustomEvent(PI_SESSION_SWITCH_EVENT, {
      detail: {
        panelId: normalizePanelId(panelId),
        sessionId,
      },
    }),
  )
}

export function requestPiNewSession(panelId) {
  const target = eventTarget()
  if (!target) return
  target.dispatchEvent(
    new CustomEvent(PI_SESSION_NEW_EVENT, {
      detail: { panelId: normalizePanelId(panelId) },
    }),
  )
}

export function subscribePiSessionActions(panelId, { onSwitch, onNew, onRequestState }) {
  const target = eventTarget()
  if (!target) return () => {}
  const normalizedPanelId = normalizePanelId(panelId)

  const handleSwitch = (event) => {
    if (normalizePanelId(event.detail?.panelId) !== normalizedPanelId) return
    onSwitch?.(event.detail?.sessionId || '')
  }
  const handleNew = (event) => {
    if (normalizePanelId(event.detail?.panelId) !== normalizedPanelId) return
    onNew?.()
  }
  const handleRequest = (event) => {
    if (normalizePanelId(event.detail?.panelId) !== normalizedPanelId) return
    onRequestState?.()
  }

  target.addEventListener(PI_SESSION_SWITCH_EVENT, handleSwitch)
  target.addEventListener(PI_SESSION_NEW_EVENT, handleNew)
  target.addEventListener(PI_SESSION_REQUEST_EVENT, handleRequest)

  return () => {
    target.removeEventListener(PI_SESSION_SWITCH_EVENT, handleSwitch)
    target.removeEventListener(PI_SESSION_NEW_EVENT, handleNew)
    target.removeEventListener(PI_SESSION_REQUEST_EVENT, handleRequest)
  }
}
