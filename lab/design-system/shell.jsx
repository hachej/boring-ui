// Section 1: the header. Kit version, light/dark, 390/1280 width, theme picker. The sections live in an inner iframe of the chosen width (the same file
// with the state in its hash), so the layout reacts to a real viewport width, and no step needs access to the other document.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { frameUrl, setState, themes, useDs } from './state.js';

const data = globalThis.BORING_DS;
const WIDTHS = ['390', '1280'];
const MODES = ['light', 'dark'];

function Choice({ label, mark, options, current, pick }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {options.map(option => (
        <Button
          key={option.value}
          size="sm"
          variant={current === option.value ? 'default' : 'outline'}
          aria-pressed={current === option.value}
          {...{ [mark]: option.value }}
          onClick={() => pick(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

const plain = list => list.map(value => ({ value, label: value }));

export function Shell() {
  const state = useDs();
  const url = useRef(null);
  url.current ??= frameUrl();
  const [applied, setApplied] = useState(null);
  useEffect(() => {
    const listen = event => { if (event.data && event.data.ds === 'applied') setApplied(event.data); };
    addEventListener('message', listen);
    return () => removeEventListener('message', listen);
  }, []);
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground" style={{ colorScheme: state.mode }} data-ds-section="header">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-background px-4 py-2">
        <h1 className="text-base font-semibold">Design system <span className="font-normal">kit {data.version}</span></h1>
        <Choice label="Mode" mark="data-ds-mode" options={plain(MODES)} current={state.mode} pick={mode => setState({ mode })} />
        <Choice label="Width" mark="data-ds-width" options={plain(WIDTHS)} current={state.width} pick={width => setState({ width })} />
        <Choice label="Theme" mark="data-ds-theme" options={themes.map(theme => ({ value: theme.name, label: theme.label }))} current={state.theme} pick={theme => setState({ theme })} />
        <p data-ds-applied={applied ? JSON.stringify(applied) : ''}>
          {applied ? `Frame: ${applied.width}px, ${applied.dark ? 'dark' : 'light'}, ${applied.theme}. ` : ''}
          The width is the real viewport of the frame below. The coarse-pointer sizes (44px targets) follow the device, not the width: open this page on a touch device to see them.
        </p>
      </header>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted p-2">
        <iframe
          data-ds-frame
          title="Design system sections"
          src={url.current}
          style={{ width: `${state.width}px`, colorScheme: state.mode }}
          className="h-full max-w-full shrink-0 rounded-md bg-background ring-1 ring-border"
        />
      </div>
    </div>
  );
}
