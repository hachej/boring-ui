import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

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

  function handleValueChange(nextValue: string): void {
    if (!isModelId(nextValue)) return
    onChange(nextValue)
  }

  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">Model</span>
      <Select disabled={disabled} onValueChange={handleValueChange} value={value}>
        <SelectTrigger aria-label="Model" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODEL_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
