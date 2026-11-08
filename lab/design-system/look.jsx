// Sections 3 to 5: type, shape and depth, density.
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useComputed } from './colors.jsx';

const data = globalThis.BORING_DS;
const Heading = ({ children }) => <h3 className="text-base font-semibold">{children}</h3>;

function Step({ step }) {
  const [ref, value] = useComputed(node => { const style = getComputedStyle(node); return `${style.fontSize} / ${style.lineHeight}`; });
  return (
    <div data-ds-step={step} className="flex items-baseline gap-4 border-b border-border py-2">
      <code className="w-16 shrink-0">text-{step}</code>
      <span ref={ref} className={`text-${step} min-w-0 flex-1`}>The quick brown fox jumps over the lazy dog</span>
      <code className="shrink-0 text-muted-foreground" data-ds-step-size>{value ?? ''}</code>
    </div>
  );
}

export function Type() {
  return (
    <section data-ds-section="type" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Type</h2>
      <Heading>Families</Heading>
      <div className="flex flex-col gap-2">
        {['sans', 'display', 'mono'].map(family => (
          <p key={family} data-ds-font={family} className="text-lg" style={{ fontFamily: `var(--font-${family})` }}>
            <code className="mr-3 text-xs" style={{ fontFamily: 'var(--font-sans)' }}>font-{family}</code>
            Pack my box with five dozen liquor jugs 0123456789
          </p>
        ))}
      </div>
      <Heading>Scale</Heading>
      <div>{data.textSteps.map(step => <Step key={step} step={step} />)}</div>
      <Heading>Tabular numbers</Heading>
      <div className="grid w-fit grid-cols-2 gap-x-8" data-ds-tabular>
        <span className="tabular-nums">1,111.11<br />8,888.88</span>
        <span>1,111.11<br />8,888.88</span>
        <code className="text-muted-foreground">tabular-nums</code>
        <code className="text-muted-foreground">proportional</code>
      </div>
    </section>
  );
}

const SHADOWS = ['xs', 'sm', 'md', 'lg'];
const SHADOW_CLASS = { xs: 'shadow-xs', sm: 'shadow-sm', md: 'shadow-md', lg: 'shadow-lg' };

function Radius({ name }) {
  const [ref, value] = useComputed(node => getComputedStyle(node).borderTopLeftRadius);
  return (
    <div data-ds-radius={name} className="flex flex-col items-center gap-1">
      <div ref={ref} className={`size-16 border border-border bg-muted rounded-${name}`} />
      <code>rounded-{name}</code>
      <code className="text-muted-foreground">{value ?? ''}</code>
    </div>
  );
}

function BorderWidth() {
  const [ref, value] = useComputed(node => getComputedStyle(node).borderTopWidth);
  return <div className="flex items-center gap-3"><div ref={ref} className="h-8 w-24 rounded-md border border-border" data-ds-border /><code>border {value ?? ''}</code></div>;
}

export function Shape() {
  return (
    <section data-ds-section="shape" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Shape and depth</h2>
      <Heading>Radius</Heading>
      <div className="flex flex-wrap gap-4">{data.radii.map(name => <Radius key={name} name={name} />)}</div>
      <Heading>Border width</Heading>
      <BorderWidth />
      <Heading>Shadow</Heading>
      <div className="flex flex-wrap gap-6 bg-muted p-6">
        {SHADOWS.map(name => (
          <div key={name} data-ds-shadow={name} className={`flex h-20 w-32 flex-col justify-between rounded-lg bg-card p-3 text-card-foreground ${SHADOW_CLASS[name]}`}>
            <code>shadow-{name}</code><span className="text-muted-foreground">on a card</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Control({ label, value }) {
  const [ref, height] = useComputed(node => `${Math.round(node.getBoundingClientRect().height)}px`);
  return (
    <div data-ds-density={label} className="flex flex-col gap-2 rounded-lg border border-border p-3" style={{ '--control-h': value }}>
      <div className="flex items-center gap-2"><code>{label}</code><code className="text-muted-foreground">--control-h {value}</code><code data-ds-control-height>{height ?? ''}</code></div>
      <div className="flex items-center gap-2">
        <span ref={ref} className="inline-flex"><Button>Button</Button></span>
        <Input aria-label={`Input at ${label}`} placeholder="Input" className="w-40" />
      </div>
    </div>
  );
}

export function Density() {
  return (
    <section data-ds-section="density" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Density</h2>
      <p className="text-muted-foreground">The control height is one token. Fine pointers get the first height, touch (coarse pointer or under 768px) the second.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Control label="fine" value={data.density.fine} />
        <Control label="touch" value={data.density.touch} />
      </div>
      <Heading>Spacing scale</Heading>
      <div className="flex flex-col gap-1">
        {[1, 2, 3, 4, 6, 8, 12, 16].map(unit => (
          <div key={unit} data-ds-space={unit} className="flex items-center gap-3">
            <code className="w-16">spacing {unit}</code>
            <span className="h-3 rounded-sm bg-primary" style={{ width: `calc(var(--spacing) * ${unit})` }} />
          </div>
        ))}
      </div>
    </section>
  );
}
