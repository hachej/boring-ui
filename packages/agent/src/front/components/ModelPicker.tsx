import type { ChangeEvent } from 'react'

export const MODEL_IDS = ['sonnet', 'haiku', 'opus'] as const

export type ModelId = (typeof MODEL_IDS)[number]

interface ModelPickerProps {
  value: ModelId
  onChange: (value: ModelId) => void
  disabled?: boolean
}

export function isModelId(value: string): value is ModelId {
  return MODEL_IDS.includes(value as ModelId)
}

export function ModelPicker(props: ModelPickerProps) {
  const { value, onChange, disabled } = props

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextValue = event.currentTarget.value
    if (!isModelId(nextValue)) return
    onChange(nextValue)
  }

  return (
    <label>
      <span>Model</span>
      <select
        aria-label="Model"
        disabled={disabled}
        onChange={handleChange}
        value={value}
      >
        {MODEL_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </label>
  )
}
