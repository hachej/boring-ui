// Section 2: colour roles. Light and dark are both drawn, whatever the toggle says: `.ds-light` and `.dark` wrappers re-declare the tokens.
import { useLayoutEffect, useRef, useState } from 'react';
import { MIN_RATIO, contrastRatio } from './contrast.js';
import { useDs } from './state.js';

const data = globalThis.BORING_DS;
const SCOPES = [['light', 'ds-light'], ['dark', 'dark ds-dark']];

/** Re-reads a computed value after every state change (the theme and the mode are applied before the render). */
export function useComputed(read) {
  const { version } = useDs();
  const ref = useRef(null);
  const [value, setValue] = useState(null);
  useLayoutEffect(() => { if (ref.current) setValue(read(ref.current)); }, [version]);
  return [ref, value];
}

function Swatch({ name, scope }) {
  const [ref, value] = useComputed(node => getComputedStyle(node).backgroundColor);
  return (
    <div className={`${scope[1]} flex items-center gap-2`}>
      <span ref={ref} aria-hidden="true" data-ds-swatch={scope[0]} className="size-6 shrink-0 rounded-md border border-border" style={{ background: `var(--${name})` }} />
      <code className="min-w-0 break-all text-muted-foreground">{value ?? ''}</code>
    </div>
  );
}

function Token({ name, scope }) {
  const [ref, value] = useComputed(node => getComputedStyle(node).getPropertyValue(`--${name}`).trim());
  return <div className={scope[1]}><code ref={ref} className="break-all text-muted-foreground">{value ?? ''}</code></div>;
}

function Role({ role }) {
  const isColor = role.kind === 'color';
  return (
    <div data-ds-role={role.name} className="grid gap-2 border-b border-border py-2 sm:grid-cols-4 sm:items-start">
      <code className="font-medium">--{role.name}</code>
      {SCOPES.map(scope => (isColor ? <Swatch key={scope[0]} name={role.name} scope={scope} /> : <Token key={scope[0]} name={role.name} scope={scope} />))}
      <div className="flex flex-wrap gap-1" data-ds-feeds>
        {role.feeds?.length
          ? role.feeds.map(token => <code key={token} className="rounded-sm bg-muted px-1 text-muted-foreground">{token}</code>)
          : <span className="text-muted-foreground">feeds no derived token</span>}
      </div>
    </div>
  );
}

function Pair({ pair, scope }) {
  const { version } = useDs();
  const ref = useRef(null);
  const [ratio, setRatio] = useState(null);
  useLayoutEffect(() => {
    const style = getComputedStyle(ref.current);
    // A surface other than the page background lies over the page background of its own scope, and that over white.
    const behind = pair.bg === 'background' ? [] : [style.getPropertyValue('--background').trim()];
    setRatio(contrastRatio(style.color, style.backgroundColor, behind));
  }, [version]);
  const low = ratio !== null && ratio < MIN_RATIO;
  return (
    <div className={`${scope[1]} flex items-center gap-2`}>
      <span ref={ref} className="rounded-sm border border-border px-2" style={{ color: `var(--${pair.fg})`, background: `var(--${pair.bg})` }}>Aa</span>
      <span data-ds-contrast={scope[0]} data-ratio={ratio === null || Number.isNaN(ratio) ? '' : ratio.toFixed(2)} className={low ? 'font-medium text-destructive' : 'text-muted-foreground'}>
        {ratio === null ? '' : Number.isNaN(ratio) ? 'n/a' : `${ratio.toFixed(2)}:1`}{low ? ` below ${MIN_RATIO}` : ''}
      </span>
    </div>
  );
}

export function Colors() {
  return (
    <section data-ds-section="colors" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Colour roles</h2>
      <p className="text-muted-foreground">Every role of the core theme, in light and dark, with the derived tokens it feeds. The values are read from the page, never typed.</p>
      <div>
        <div className="hidden grid-cols-4 gap-2 border-b border-border py-1 font-medium text-muted-foreground sm:grid"><span>Role</span><span>Light</span><span>Dark</span><span>Feeds</span></div>
        {data.roles.map(role => <Role key={role.name} role={role} />)}
      </div>
      <h3 className="text-base font-semibold">Contrast of text on surface</h3>
      <p className="text-muted-foreground">The WCAG ratio is measured in this browser from the painted colours. Under {MIN_RATIO} is marked.</p>
      <div>
        {data.pairs.map(pair => (
          <div key={`${pair.fg}/${pair.bg}`} data-ds-pair={`${pair.fg}/${pair.bg}`} className="grid gap-2 border-b border-border py-2 sm:grid-cols-3 sm:items-center">
            <code>{pair.fg} on {pair.bg}</code>
            {SCOPES.map(scope => <Pair key={scope[0]} pair={pair} scope={scope} />)}
          </div>
        ))}
      </div>
    </section>
  );
}
