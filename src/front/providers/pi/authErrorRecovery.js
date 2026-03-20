const providerLabelFromId = (provider) => {
  const normalized = String(provider || '').trim()
  if (!normalized) return 'Provider'
  return normalized
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

export const isProviderAuthenticationError = (errorMessage) => {
  const normalized = String(errorMessage || '').toLowerCase()
  if (!normalized) return false
  return [
    'authentication_error',
    'invalid x-api-key',
    'invalid api key',
    'incorrect api key',
    'invalid_api_key',
    'unauthorized',
  ].some((pattern) => normalized.includes(pattern))
}

export const buildApiKeyPromptMessage = (provider, { retry = false } = {}) => {
  const label = `${providerLabelFromId(provider)} API key`
  if (retry) {
    return `Saved ${label} was rejected. Enter a new ${label} to continue in this browser session:`
  }
  return `Enter ${label} to use the agent in this browser session:`
}

export const recoverProviderAuthenticationError = async ({
  event,
  agent,
  runtime,
  handledFailures,
  promptForKey,
}) => {
  if (event?.type !== 'message_end') return false

  const message = event?.message
  if (message?.role !== 'assistant' || message?.stopReason !== 'error') return false
  if (!isProviderAuthenticationError(message?.errorMessage)) return false

  const provider = String(agent?.state?.model?.provider || '').trim()
  if (!provider) return false

  const failureKey = [
    provider,
    String(message?.timestamp || ''),
    String(message?.errorMessage || ''),
  ].join(':')

  if (handledFailures?.has(failureKey)) return false
  handledFailures?.add(failureKey)

  await runtime.providerKeys.delete(provider)
  await promptForKey(provider, runtime, { retry: true, errorMessage: message?.errorMessage || '' })
  return true
}
