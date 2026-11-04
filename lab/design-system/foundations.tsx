import { Block, Section } from './kit';

const core = ['background', 'card', 'foreground', 'primary', 'secondary', 'accent', 'muted', 'muted-foreground', 'border', 'ring', 'sidebar'];
const status = ['destructive', 'success', 'warning', 'info'];
const chart = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];

function Swatches({ names }: { readonly names: readonly string[] }) {
  return <div className="gx-swatches">{names.map(name => <div key={name} className="gx-swatch"><i style={{ background: `var(--${name})` }} /><code>--{name}</code></div>)}</div>;
}

const roles: ReadonlyArray<readonly [string, string, string]> = [
  ['Title', 'text-[length:var(--text-title)] font-semibold', 'Page and card titles, 14px semibold'],
  ['Body', 'text-[length:var(--text-body)]', 'Everything else, 12px'],
  ['Muted', 'text-[length:var(--text-body)] text-muted-foreground', 'Secondary lines, labels, hints'],
  ['Mono', 'font-mono text-[length:var(--text-body)]', 'Numbers, ids, code'],
];

export function Foundations() {
  return <Section id="foundations" title="Foundations" lead="Semantic tokens only. A block never names a colour, a size or a radius: it reads these.">
    <Block name="Tokens: core" tokens="--background --card --foreground --primary --border"><Swatches names={core} /></Block>
    <Block name="Tokens: status" tokens="--destructive --success --warning --info"><Swatches names={status} /></Block>
    <Block name="Tokens: chart" tokens="--chart-1 .. --chart-5"><Swatches names={chart} /></Block>
    <Block name="Type roles" tokens="--text-title --text-body --font-sans --font-mono">
      <div className="gx-stack">{roles.map(([name, cls, use]) => <div key={name} className="gx-row"><span className="gx-kicker">{name}</span><span className={cls}>The quick brown fox, 1 204,50</span><span className="text-muted-foreground">{use}</span></div>)}</div>
    </Block>
    <Block name="Spacing and gap" tokens="Tailwind scale: gap-1 .. gap-6">
      <div className="gx-stack">{[1, 2, 3, 4, 6, 8].map(n => <div key={n} className="gx-row"><code className="gx-kicker">gap-{n}</code><i className="gx-bar" style={{ width: `calc(var(--spacing, 0.25rem) * ${n})` }} /><span className="text-muted-foreground">{n * 4}px</span></div>)}</div>
    </Block>
    <Block name="Radius" tokens="--radius (rounded-sm, -md, -lg, -xl)">
      <div className="gx-row">{['sm', 'md', 'lg', 'xl'].map(r => <div key={r} className={`gx-radius rounded-${r}`}><code>{r}</code></div>)}</div>
    </Block>
  </Section>;
}
