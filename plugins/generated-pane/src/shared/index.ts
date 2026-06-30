export interface GeneratedPaneElementSpec {
  type: string
  props?: Record<string, unknown>
  children?: string[]
}

export interface GeneratedPaneSpec {
  kind: "boring.generated-pane"
  version: 1
  profile?: string
  title?: string
  description?: string
  root: string
  elements: Record<string, GeneratedPaneElementSpec>
  queries?: Record<string, unknown>
}

export interface GeneratedPaneValidationResult {
  spec: GeneratedPaneSpec | null
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

export function parseGeneratedPaneSpec(value: unknown): GeneratedPaneValidationResult {
  const errors: string[] = []
  if (!isRecord(value)) return { spec: null, errors: ["generated pane spec must be an object"] }
  if (value.kind !== "boring.generated-pane") errors.push('generated pane spec kind must be "boring.generated-pane"')
  if (value.version !== 1) errors.push("generated pane spec version must be 1")
  if (value.profile !== undefined && typeof value.profile !== "string") errors.push("generated pane profile must be a string")
  if (value.title !== undefined && typeof value.title !== "string") errors.push("generated pane title must be a string")
  if (value.description !== undefined && typeof value.description !== "string") errors.push("generated pane description must be a string")
  if (typeof value.root !== "string" || value.root.length === 0) errors.push("generated pane root must be a string")
  if (!isRecord(value.elements)) {
    errors.push("generated pane elements must be an object")
  } else {
    for (const [id, element] of Object.entries(value.elements)) {
      if (!isRecord(element)) {
        errors.push(`element ${id} must be an object`)
        continue
      }
      if (typeof element.type !== "string" || element.type.length === 0) errors.push(`element ${id} must include type`)
      if (element.props !== undefined && !isRecord(element.props)) errors.push(`element ${id}.props must be an object`)
      if (element.children !== undefined && !isStringArray(element.children)) errors.push(`element ${id}.children must be an array of ids`)
    }
  }
  if (isRecord(value.elements) && typeof value.root === "string") validateAcyclic(value.root, value.elements, errors)
  if (value.queries !== undefined && !isRecord(value.queries)) errors.push("generated pane queries must be an object")
  if (errors.length > 0) return { spec: null, errors }
  return { spec: value as unknown as GeneratedPaneSpec, errors: [] }
}

function validateAcyclic(root: string, elements: Record<string, unknown>, errors: string[]): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      errors.push(`generated pane element cycle: ${[...path, id].join(" -> ")}`)
      return
    }
    if (visited.has(id)) return
    const element = elements[id]
    if (!isRecord(element)) {
      errors.push(`element ${id} is referenced but not defined`)
      return
    }
    visiting.add(id)
    if (isStringArray(element.children)) {
      for (const child of element.children) visit(child, [...path, id])
    }
    visiting.delete(id)
    visited.add(id)
  }
  visit(root, [])
}
