// The labelled-row pattern (D-1729) as an app writes it: shadcn's Field inside a FieldLabel, so one <label> wraps the control and its
// text and a tap anywhere on the row is the control's tap. Fictional text. Counters on `window.counts` record every change.
import { createRoot } from "react-dom/client"
import { useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"

declare global { interface Window { counts: Record<string, number> } }
window.counts = {}
const count = (id: string) => { window.counts[id] = (window.counts[id] ?? 0) + 1 }

const LONG = "Send me a weekly summary of the garden journal, including the notes from every plot, the watering schedule and the planting calendar for the next month"

type RowProps = { id: string; title: string; description?: string; disabled?: boolean }

function Text({ title, description }: Pick<RowProps, "title" | "description">) {
  return <FieldContent><FieldTitle>{title}</FieldTitle>{description && <FieldDescription>{description}</FieldDescription>}</FieldContent>
}

function Check({ id, title, description, disabled, defaultChecked }: RowProps & { defaultChecked?: boolean }) {
  return (
    <FieldLabel data-testid={`row-${id}`}>
      <Field orientation="horizontal" data-disabled={disabled}>
        <Checkbox data-testid={`control-${id}`} disabled={disabled} defaultChecked={defaultChecked} onCheckedChange={() => count(id)} />
        <Text title={title} description={description} />
      </Field>
    </FieldLabel>
  )
}

function Toggle({ id, title, description, disabled }: RowProps) {
  return (
    <FieldLabel data-testid={`row-${id}`}>
      <Field orientation="horizontal" data-disabled={disabled}>
        <Text title={title} description={description} />
        <Switch data-testid={`control-${id}`} disabled={disabled} onCheckedChange={() => count(id)} />
      </Field>
    </FieldLabel>
  )
}

function Choice({ id, title, description, disabled }: RowProps) {
  return (
    <FieldLabel data-testid={`row-${id}`}>
      <Field orientation="horizontal" data-disabled={disabled}>
        <RadioGroupItem value={id} data-testid={`control-${id}`} disabled={disabled} />
        <Text title={title} description={description} />
      </Field>
    </FieldLabel>
  )
}

function Page() {
  const [plan, setPlan] = useState("seed")
  return (
    <main className="mx-auto flex w-full max-w-[390px] flex-col gap-8 bg-background p-4 text-foreground">
      <FieldSet>
        <FieldLegend variant="label">Notifications</FieldLegend>
        <FieldGroup className="gap-3">
          <Check id="a" title="Watering reminders" defaultChecked />
          <Check id="b" title="Harvest notes" description="One message when a crop is ready." />
          <Check id="c" title={LONG} />
          <Check id="d" title="Frost warnings" description="Paused for this garden." disabled />
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Plan</FieldLegend>
        <RadioGroup value={plan} onValueChange={value => { count(String(value)); setPlan(String(value)) }}>
          <Choice id="seed" title="Seed" description="Up to three beds." />
          <Choice id="bloom" title="Bloom" />
          <Choice id="orchard" title="Orchard" description="Retired." disabled />
        </RadioGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Sharing</FieldLegend>
        <FieldGroup className="gap-3">
          <Toggle id="s1" title="Share the journal" />
          <Toggle id="s2" title="Let neighbours see the plot map" description="They can look, not edit." />
          <Toggle id="s3" title={LONG} />
          <Toggle id="s4" title="Public page" disabled />
        </FieldGroup>
      </FieldSet>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<Page />)
