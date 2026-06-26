export function assertProductionAgentModeIsSafe(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return
  if (env.BORING_ALLOW_UNSAFE_AGENT_MODE === '1') return

  const mode = env.BORING_AGENT_MODE
  if (mode !== 'vercel-sandbox') {
    throw new Error(
      `BORING_AGENT_MODE=${mode ?? '<unset>'} is not allowed in production full-app. ` +
        'Set BORING_AGENT_MODE=vercel-sandbox or set BORING_ALLOW_UNSAFE_AGENT_MODE=1 only for an explicitly approved deployment.',
    )
  }
}
