const parseBoolEnv = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export default {
  features: {
    codeSessions: true,
    agentRailMode: import.meta.env.VITE_AGENT_RAIL_MODE || 'all',
    controlPlaneOnboarding: parseBoolEnv(import.meta.env.VITE_CONTROL_PLANE_ONBOARDING),
  },
}
