export const THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

interface ThinkingToggleProps {
  value: ThinkingLevel
  onChange: (value: ThinkingLevel) => void
  disabled?: boolean
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel)
}

export function ThinkingToggle(props: ThinkingToggleProps) {
  const { value, onChange, disabled } = props

  return (
    <fieldset>
      <legend>Thinking</legend>
      {THINKING_LEVELS.map((level) => (
        <button
          key={level}
          aria-pressed={value === level}
          disabled={disabled}
          onClick={() => onChange(level)}
          type="button"
        >
          {level}
        </button>
      ))}
    </fieldset>
  )
}
