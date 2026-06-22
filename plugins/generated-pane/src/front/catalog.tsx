import type { ReactNode } from "react"
import { defineCatalog } from "@json-render/core"
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react"
import { schema } from "@json-render/react/schema"
import { z } from "zod"
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hachej/boring-ui-kit"
import type { GeneratedPaneSpec } from "../shared"

export type GeneratedPaneActionHandler = (params: Record<string, unknown>) => void | Promise<void>

export interface GeneratedPaneComponentDefinition {
  props: z.ZodObject<Record<string, z.ZodType>>
  slots?: string[]
  description: string
  component: (props: { props: Record<string, unknown>; children?: ReactNode; emit: (event: string) => void }) => ReactNode
}

export interface GeneratedPaneActionDefinition {
  description: string
  params?: z.ZodObject<Record<string, z.ZodType>>
  handler?: GeneratedPaneActionHandler
}

export interface GeneratedPaneProfile {
  id: string
  label: string
  components: Record<string, GeneratedPaneComponentDefinition>
  actions?: Record<string, GeneratedPaneActionDefinition>
}

export function defineGeneratedPaneProfile(profile: GeneratedPaneProfile): GeneratedPaneProfile {
  return profile
}

export const baseGeneratedPaneProfile = defineGeneratedPaneProfile({
  id: "base",
  label: "Generated Pane",
  components: {
    Card: {
      description: "A bordered content card with an optional title and description.",
      slots: ["default"],
      props: z.object({ title: z.string().optional(), description: z.string().optional() }),
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
      description: "Vertical stack for grouping child elements.",
      slots: ["default"],
      props: z.object({ gap: z.enum(["sm", "md", "lg"]).optional() }),
      component: ({ props, children }) => <div className={props.gap === "sm" ? "space-y-2" : props.gap === "lg" ? "space-y-6" : "space-y-4"}>{children}</div>,
    },
    Grid: {
      description: "Responsive grid layout for child elements.",
      slots: ["default"],
      props: z.object({ columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional() }),
      component: ({ props, children }) => {
        const columns = props.columns === 3 ? "lg:grid-cols-3" : props.columns === 4 ? "lg:grid-cols-4" : props.columns === 1 ? "grid-cols-1" : "lg:grid-cols-2"
        return <div className={`grid gap-4 ${columns}`}>{children}</div>
      },
    },
    Text: {
      description: "Plain text block.",
      props: z.object({ text: z.string(), tone: z.enum(["default", "muted"]).optional() }),
      component: ({ props }) => <p className={props.tone === "muted" ? "text-sm text-muted-foreground" : "text-sm text-foreground"}>{String(props.text)}</p>,
    },
    Badge: {
      description: "Small status badge.",
      props: z.object({ label: z.string(), variant: z.enum(["default", "secondary", "outline"]).optional() }),
      component: ({ props }) => <Badge variant={(props.variant as "default" | "secondary" | "outline" | undefined) ?? "secondary"}>{String(props.label)}</Badge>,
    },
    Alert: {
      description: "Notice block for warnings, status, or context.",
      props: z.object({ title: z.string(), description: z.string().optional() }),
      component: ({ props }) => (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="font-medium text-foreground">{String(props.title)}</div>
          {typeof props.description === "string" ? <div className="mt-1 text-muted-foreground">{props.description}</div> : null}
        </div>
      ),
    },
    Button: {
      description: "Button that emits its press event to a configured action.",
      props: z.object({ label: z.string() }),
      component: ({ props, emit }) => <Button size="sm" onClick={() => emit("press")}>{String(props.label)}</Button>,
    },
  },
})

export function mergeGeneratedPaneProfiles(...profiles: GeneratedPaneProfile[]): GeneratedPaneProfile {
  const [first, ...rest] = profiles
  return {
    id: first?.id ?? "generated-pane",
    label: first?.label ?? "Generated Pane",
    components: Object.assign({}, ...profiles.map((profile) => profile.components)),
    actions: Object.assign({}, ...profiles.map((profile) => profile.actions ?? {})),
  }
}

export function createGeneratedPaneCatalog(profile: GeneratedPaneProfile) {
  return defineCatalog(schema, {
    components: Object.fromEntries(Object.entries(profile.components).map(([name, definition]) => [name, {
      props: definition.props,
      slots: definition.slots ?? [],
      description: definition.description,
    }])),
    actions: Object.fromEntries(Object.entries(profile.actions ?? {}).map(([name, definition]) => [name, {
      params: definition.params,
      description: definition.description,
    }])),
  })
}

export function GeneratedPaneRenderer({ spec, profile }: { spec: GeneratedPaneSpec; profile?: GeneratedPaneProfile }) {
  const activeProfile = profile ? mergeGeneratedPaneProfiles(baseGeneratedPaneProfile, profile) : baseGeneratedPaneProfile
  const catalog = createGeneratedPaneCatalog(activeProfile)
  const normalizedElements = Object.fromEntries(Object.entries(spec.elements).map(([id, element]) => [id, {
    ...element,
    props: element.props ?? {},
    children: element.children ?? [],
    visible: "visible" in element ? element.visible : true,
  }]))
  const validation = catalog.validate({ root: spec.root, elements: normalizedElements })
  if (!validation.success) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Invalid generated pane spec: {validation.error?.issues.slice(0, 3).map((issue) => issue.message).join(" • ")}</div>
  }
  if (!validation.data) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Invalid generated pane spec</div>
  }
  const { registry } = defineRegistry(catalog, {
    components: Object.fromEntries(Object.entries(activeProfile.components).map(([name, definition]) => [name, ({ props, children, emit }: { props: Record<string, unknown>; children?: ReactNode; emit: (event: string) => void }) => definition.component({ props, children, emit })])),
    actions: {},
  })
  return (
    <JSONUIProvider registry={registry} handlers={{}}>
      <Renderer spec={validation.data as never} registry={registry} />
    </JSONUIProvider>
  )
}
