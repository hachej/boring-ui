export function displayModelLabel(id: string): string {
  // "claude-sonnet-4-6" → "Claude Sonnet 4.6"
  // "gpt-5.3-codex" → "GPT-5.3 Codex"
  const modelId = id.split('/').pop() ?? id
  return modelId
    .replace(/[-_]/g, ' ')
    .replace(/\s(\d+)\s(\d+)/g, ' $1.$2')
    .replace(/\bgpt\b/g, 'GPT')
    .replace(/\b(qwen|grok|glm|claude|sonnet|haiku|opus|codex|mini|max|spark|flash|turbo|pro|omni|mimo|deepseek|euryale)\b/g, (m) =>
      m.charAt(0).toUpperCase() + m.slice(1),
    )
}

export function displayProviderLabel(provider: string): string {
  const known: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    'openai-codex': 'OpenAI Codex',
    infomaniak: 'Infomaniak',
  }
  if (known[provider]) return known[provider]
  return provider
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
