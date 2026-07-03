import { z } from "zod"

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

export type GeneratedPaneDiagnosticSeverity = "error" | "warning" | "info"

export const GENERATED_PANE_DIAGNOSTIC_CODES = {
  invalidRoot: "generated-pane.invalid_root",
  invalidElements: "generated-pane.invalid_elements",
  missingElement: "generated-pane.missing_element",
  elementCycle: "generated-pane.element_cycle",
  unknownComponent: "generated-pane.unknown_component",
  invalidProps: "generated-pane.invalid_props",
  unsupportedProfile: "generated-pane.unsupported_profile",
} as const

export type GeneratedPaneDiagnosticCode = typeof GENERATED_PANE_DIAGNOSTIC_CODES[keyof typeof GENERATED_PANE_DIAGNOSTIC_CODES]

export interface GeneratedPaneDiagnostic {
  severity: GeneratedPaneDiagnosticSeverity
  code: GeneratedPaneDiagnosticCode
  message: string
  elementId?: string
  path?: string
}

export interface GeneratedPaneComponentVocabularyEntry {
  description: string
  props: z.ZodTypeAny
  slots?: string[]
}

export interface GeneratedPaneVocabulary {
  id: string
  label: string
  components: Record<string, GeneratedPaneComponentVocabularyEntry>
  diagnostics?: Array<(spec: GeneratedPaneSpec) => GeneratedPaneDiagnostic[]>
}

export interface GeneratedPaneValidationResult {
  spec: GeneratedPaneSpec | null
  errors: string[]
}

export interface GeneratedPaneDiagnosticsResult {
  spec: GeneratedPaneSpec | null
  diagnostics: GeneratedPaneDiagnostic[]
}

export function defineGeneratedPaneVocabulary(vocabulary: GeneratedPaneVocabulary): GeneratedPaneVocabulary {
  return vocabulary
}

export const baseGeneratedPaneVocabulary = defineGeneratedPaneVocabulary({
  id: "base",
  label: "Generated Pane",
  components: {
    Card: {
      description: "A bordered content card with an optional title and description.",
      slots: ["default"],
      props: z.object({ title: z.string().optional(), description: z.string().optional() }),
    },
    Stack: {
      description: "Vertical stack for grouping child elements.",
      slots: ["default"],
      props: z.object({ gap: z.enum(["sm", "md", "lg"]).optional() }),
    },
    Grid: {
      description: "Responsive grid layout for child elements.",
      slots: ["default"],
      props: z.object({ columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional() }),
    },
    Text: {
      description: "Plain text block.",
      props: z.object({ text: z.string(), tone: z.enum(["default", "muted"]).optional() }),
    },
    Badge: {
      description: "Small status badge.",
      props: z.object({ label: z.string(), variant: z.enum(["default", "secondary", "outline"]).optional() }),
    },
    Alert: {
      description: "Notice block for warnings, status, or context.",
      props: z.object({ title: z.string(), description: z.string().optional() }),
    },
  },
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function diagnostic(code: GeneratedPaneDiagnosticCode, message: string, options: Omit<GeneratedPaneDiagnostic, "severity" | "code" | "message"> & { severity?: GeneratedPaneDiagnosticSeverity } = {}): GeneratedPaneDiagnostic {
  const { severity = "error", ...rest } = options
  return { severity, code, message, ...rest }
}

function schemaPath(path: PropertyKey[]): string | undefined {
  return path.length ? path.map(String).join(".") : undefined
}

export function validateGeneratedPaneSpec(value: unknown, vocabulary: GeneratedPaneVocabulary = baseGeneratedPaneVocabulary): GeneratedPaneDiagnosticsResult {
  const diagnostics: GeneratedPaneDiagnostic[] = []
  if (!isRecord(value)) {
    return { spec: null, diagnostics: [diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, "generated pane spec must be an object")] }
  }

  if (value.kind !== "boring.generated-pane") diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, 'generated pane spec kind must be "boring.generated-pane"', { path: "kind" }))
  if (value.version !== 1) diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, "generated pane spec version must be 1", { path: "version" }))
  if (value.profile !== undefined && typeof value.profile !== "string") diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, "generated pane profile must be a string", { path: "profile" }))
  if (value.title !== undefined && typeof value.title !== "string") diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, "generated pane title must be a string", { path: "title" }))
  if (value.description !== undefined && typeof value.description !== "string") diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, "generated pane description must be a string", { path: "description" }))
  if (typeof value.root !== "string" || value.root.length === 0) diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, "generated pane root must be a string", { path: "root" }))
  if (value.queries !== undefined && !isRecord(value.queries)) diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot, "generated pane queries must be an object", { path: "queries" }))

  if (!isRecord(value.elements)) {
    diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidElements, "generated pane elements must be an object", { path: "elements" }))
  } else {
    for (const [id, element] of Object.entries(value.elements)) {
      if (!isRecord(element)) {
        diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidElements, `element ${id} must be an object`, { elementId: id, path: `elements.${id}` }))
        continue
      }
      if (typeof element.type !== "string" || element.type.length === 0) diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidElements, `element ${id} must include type`, { elementId: id, path: `elements.${id}.type` }))
      if (element.props !== undefined && !isRecord(element.props)) diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidElements, `element ${id}.props must be an object`, { elementId: id, path: `elements.${id}.props` }))
      if (element.children !== undefined && !isStringArray(element.children)) diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidElements, `element ${id}.children must be an array of ids`, { elementId: id, path: `elements.${id}.children` }))
    }
  }

  if (isRecord(value.elements) && typeof value.root === "string") validateGraph(value.root, value.elements, diagnostics)

  const fatal = diagnostics.some((item) => item.code === GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot || item.code === GENERATED_PANE_DIAGNOSTIC_CODES.invalidElements || item.code === GENERATED_PANE_DIAGNOSTIC_CODES.missingElement || item.code === GENERATED_PANE_DIAGNOSTIC_CODES.elementCycle)
  if (fatal) return { spec: null, diagnostics }

  const spec = value as unknown as GeneratedPaneSpec
  const declaredProfile = spec.profile ?? "base"
  if (declaredProfile !== vocabulary.id) {
    diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.unsupportedProfile, `generated pane profile ${declaredProfile} is not supported by active vocabulary ${vocabulary.id}`, { path: "profile" }))
  }

  for (const [id, element] of Object.entries(spec.elements)) {
    const entry = vocabulary.components[element.type]
    if (!entry) {
      diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.unknownComponent, `component ${id} has unsupported type ${element.type}`, { elementId: id, path: `elements.${id}.type` }))
      continue
    }
    const parsed = entry.props.safeParse(element.props ?? {})
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const propPath = schemaPath(issue.path)
        diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.invalidProps, `component ${id}.props${propPath ? `.${propPath}` : ""}: ${issue.message}`, { elementId: id, path: propPath ? `elements.${id}.props.${propPath}` : `elements.${id}.props` }))
      }
    }
  }

  for (const check of vocabulary.diagnostics ?? []) diagnostics.push(...check(spec))
  return { spec, diagnostics }
}

export function parseGeneratedPaneSpec(value: unknown, vocabulary: GeneratedPaneVocabulary = baseGeneratedPaneVocabulary): GeneratedPaneValidationResult {
  const result = validateGeneratedPaneSpec(value, vocabulary)
  return {
    spec: result.diagnostics.some((item) => item.severity === "error") ? null : result.spec,
    errors: result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message),
  }
}

function validateGraph(root: string, elements: Record<string, unknown>, diagnostics: GeneratedPaneDiagnostic[]): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.elementCycle, `generated pane element cycle: ${[...path, id].join(" -> ")}`, { elementId: id, path: `elements.${id}` }))
      return
    }
    if (visited.has(id)) return
    const element = elements[id]
    if (!isRecord(element)) {
      diagnostics.push(diagnostic(GENERATED_PANE_DIAGNOSTIC_CODES.missingElement, `element ${id} is referenced but not defined`, { elementId: id, path: `elements.${id}` }))
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
