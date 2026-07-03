import { useMemo, type ReactNode } from "react"
import { defineCatalog } from "@json-render/core"
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react"
import { schema } from "@json-render/react/schema"
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hachej/boring-ui-kit"
import {
  baseGeneratedPaneVocabulary,
  validateGeneratedPaneSpec,
  type GeneratedPaneComponentVocabularyEntry,
  type GeneratedPaneSpec,
  type GeneratedPaneVocabulary,
} from "../shared"

export interface GeneratedPaneComponentProps {
  props: Record<string, unknown>
  children?: ReactNode
}

export interface GeneratedPaneComponentBinding {
  component: (props: GeneratedPaneComponentProps) => ReactNode
}

export interface GeneratedPaneComponentDefinition extends GeneratedPaneComponentVocabularyEntry, GeneratedPaneComponentBinding {}

export interface GeneratedPaneProfile {
  vocabulary: GeneratedPaneVocabulary
  components: Record<string, GeneratedPaneComponentBinding>
}

export function defineGeneratedPaneProfile(profile: GeneratedPaneProfile): GeneratedPaneProfile {
  const componentKeys = new Set(Object.keys(profile.components))
  const vocabularyKeys = new Set(Object.keys(profile.vocabulary.components))
  const bindingWithoutVocabulary = [...componentKeys].filter((key) => !vocabularyKeys.has(key))
  const vocabularyWithoutBinding = [...vocabularyKeys].filter((key) => !componentKeys.has(key))
  if (bindingWithoutVocabulary.length > 0) throw new Error(`generated pane profile ${profile.vocabulary.id} has render bindings without vocabulary entries: ${bindingWithoutVocabulary.join(", ")}`)
  if (vocabularyWithoutBinding.length > 0) throw new Error(`generated pane profile ${profile.vocabulary.id} has vocabulary entries without render bindings: ${vocabularyWithoutBinding.join(", ")}`)
  return profile
}

export function defineLegacyGeneratedPaneProfile(profile: { id: string; label: string; components: Record<string, GeneratedPaneComponentDefinition> }): GeneratedPaneProfile {
  return defineGeneratedPaneProfile({
    vocabulary: {
      id: profile.id,
      label: profile.label,
      components: Object.fromEntries(Object.entries(profile.components).map(([key, value]) => [key, { description: value.description, props: value.props, slots: value.slots }])),
    },
    components: Object.fromEntries(Object.entries(profile.components).map(([key, value]) => [key, { component: value.component }])),
  })
}

export const baseGeneratedPaneProfile = defineGeneratedPaneProfile({
  vocabulary: baseGeneratedPaneVocabulary,
  components: {
    Card: {
      component: ({ props, children }) => (
        <Card>
          {props.title || props.description ? (
            <CardHeader>
              {typeof props.title === "string" ? <CardTitle>{props.title}</CardTitle> : null}
              {typeof props.description === "string" ? <CardDescription>{props.description}</CardDescription> : null}
            </CardHeader>
          ) : null}
          <CardContent>{children}</CardContent>
        </Card>
      ),
    },
    Stack: {
      component: ({ props, children }) => <div className={props.gap === "sm" ? "space-y-2" : props.gap === "lg" ? "space-y-6" : "space-y-4"}>{children}</div>,
    },
    Grid: {
      component: ({ props, children }) => {
        const columns = props.columns === 3 ? "lg:grid-cols-3" : props.columns === 4 ? "lg:grid-cols-4" : props.columns === 1 ? "grid-cols-1" : "lg:grid-cols-2"
        return <div className={`grid gap-4 ${columns}`}>{children}</div>
      },
    },
    Text: {
      component: ({ props }) => <p className={props.tone === "muted" ? "text-sm text-muted-foreground" : "text-sm text-foreground"}>{String(props.text)}</p>,
    },
    Badge: {
      component: ({ props }) => <Badge variant={(props.variant as "default" | "secondary" | "outline" | undefined) ?? "secondary"}>{String(props.label)}</Badge>,
    },
    Alert: {
      component: ({ props }) => (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="font-medium text-foreground">{String(props.title)}</div>
          {typeof props.description === "string" ? <div className="mt-1 text-muted-foreground">{props.description}</div> : null}
        </div>
      ),
    },
  },
})

export function mergeGeneratedPaneProfiles(...profiles: GeneratedPaneProfile[]): GeneratedPaneProfile {
  const [first, ...rest] = profiles
  const mergedVocabularyComponents: Record<string, GeneratedPaneComponentVocabularyEntry> = Object.assign({}, ...profiles.map((profile) => profile.vocabulary.components))
  const mergedBindings: Record<string, GeneratedPaneComponentBinding> = Object.assign({}, ...profiles.map((profile) => profile.components))
  const finalProfile = rest.at(-1) ?? first
  return defineGeneratedPaneProfile({
    vocabulary: {
      id: finalProfile?.vocabulary.id ?? "base",
      label: finalProfile?.vocabulary.label ?? "Generated Pane",
      components: Object.fromEntries(Object.entries(mergedVocabularyComponents).filter(([key]) => key in mergedBindings)),
      diagnostics: profiles.flatMap((profile) => profile.vocabulary.diagnostics ?? []),
    },
    components: Object.fromEntries(Object.entries(mergedBindings).filter(([key]) => key in mergedVocabularyComponents)),
  })
}

export function createGeneratedPaneCatalog(profile: GeneratedPaneProfile) {
  return defineCatalog(schema, {
    components: Object.fromEntries(Object.entries(profile.vocabulary.components).map(([name, definition]) => [name, {
      props: definition.props,
      slots: definition.slots ?? [],
      description: definition.description,
    }])),
    actions: {},
  })
}

export function GeneratedPaneRenderer({ spec, profile }: { spec: GeneratedPaneSpec; profile?: GeneratedPaneProfile }) {
  const activeProfile = useMemo(() => profile ? mergeGeneratedPaneProfiles(baseGeneratedPaneProfile, profile) : baseGeneratedPaneProfile, [profile])
  const catalog = useMemo(() => createGeneratedPaneCatalog(activeProfile), [activeProfile])
  const normalizedElements = useMemo(() => Object.fromEntries(Object.entries(spec.elements).map(([id, element]) => [id, {
    ...element,
    props: element.props ?? {},
    children: element.children ?? [],
    visible: "visible" in element ? element.visible : true,
  }])), [spec.elements])
  const diagnostics = useMemo(() => validateGeneratedPaneSpec(spec, activeProfile.vocabulary).diagnostics, [activeProfile.vocabulary, spec])
  const errors = diagnostics.filter((item) => item.severity === "error")
  if (errors.length > 0) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Invalid generated pane spec: {errors.slice(0, 3).map((issue) => issue.message).join(" • ")}</div>
  }
  const validation = catalog.validate({ root: spec.root, elements: normalizedElements })
  if (!validation.success) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Invalid generated pane spec: {validation.error?.issues.slice(0, 3).map((issue) => issue.message).join(" • ")}</div>
  }
  if (!validation.data) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Invalid generated pane spec</div>
  }
  const { registry } = defineRegistry(catalog, {
    components: Object.fromEntries(Object.entries(activeProfile.components).map(([name, definition]) => [name, ({ props, children }: { props: unknown; children?: ReactNode }) => definition.component({ props: props && typeof props === "object" && !Array.isArray(props) ? props as Record<string, unknown> : {}, children })])) as never,
    actions: {},
  })
  return (
    <JSONUIProvider registry={registry} handlers={{}}>
      <Renderer spec={validation.data as never} registry={registry} />
    </JSONUIProvider>
  )
}
