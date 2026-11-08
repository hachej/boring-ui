// Shared parts of the component demos: the cva dimensions read from the components' own source (data.js), the demo wrapper that names what it
// renders (data-ds-component), an error guard so one failing demo is shown and the rest still render, and the bounded box for overlays.
import { Component, useLayoutEffect, useRef } from 'react';

const data = globalThis.BORING_DS;

/** The cva dimensions of a component file: { variant: [...], size: [...] }. `cva` names one `const x = cva(...)` of a file with several. */
export function groupsOf(file, cva) {
  const entries = data.components[file]?.variants ?? [];
  return Object.assign({}, ...entries.filter(entry => !cva || entry.name === cva).map(entry => entry.groups));
}

class Guard extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error: String(error?.message ?? error) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <p role="alert" data-ds-error={this.props.title} className="text-destructive">{this.props.title} failed to render: {this.state.error}</p>;
  }
}

/** `names` are the kit exports this demo renders (the coverage test checks each name's real data-slot output inside it). */
export function Demo({ names, title, note, children }) {
  return (
    <div data-ds-component={names} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {note ? <p>{note}</p> : null}
      <Guard title={title}>{children}</Guard>
    </div>
  );
}

export const Label = ({ children }) => <code className="whitespace-nowrap">{children}</code>;

// One observer for every bounded box: an overlay portals to the end of <body>; the box that owns its id adopts it.
const boxes = new Map();
let watcher = null;

function adopt() {
  let moved = false;
  for (const [id, box] of boxes) {
    for (const node of document.querySelectorAll(`[data-ds-overlay="${id}"], [data-ds-overlay^="${id}:"]`)) {
      if (box.contains(node)) continue;
      let host = node;
      while (host.parentElement && host.parentElement !== document.body) host = host.parentElement;
      if (host.parentElement !== document.body) continue;
      box.appendChild(host);
      moved = true;
    }
  }
  // Floating parts measured their anchor before the move: ask them to measure again.
  if (moved) dispatchEvent(new Event('resize'));
}

function register(id, box) {
  boxes.set(id, box);
  watcher ??= new MutationObserver(adopt);
  if (boxes.size === 1) watcher.observe(document.body, { childList: true, subtree: true });
  adopt();
  return () => {
    boxes.delete(id);
    if (!boxes.size) watcher.disconnect();
  };
}

/** A bounded box for an overlay: the transform makes it the containing block of `position: fixed`, and the portal host is moved into it. */
export function Bounded({ id, height = 360, children }) {
  const box = useRef(null);
  useLayoutEffect(() => register(id, box.current), [id]);
  const style = { height, transform: 'translateZ(0)', '--overlay-height-tall': `${Math.round(height * 0.85)}px`, '--overlay-height-full': `${height}px` };
  return (
    <div ref={box} data-ds-bounded={id} className="relative overflow-hidden rounded-lg border border-border bg-muted" style={style}>
      {children}
    </div>
  );
}

/** A bounded overlay demo cell with a caption. */
export function Framed({ id, caption, height, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-ds-framed={id}>
      <Label>{caption}</Label>
      <Bounded id={id} height={height}>{children}</Bounded>
    </div>
  );
}

/** Open, non-modal, no focus moves: a static frame of an overlay. */
export const STATIC = { modal: false, open: true, onOpenChange: () => {} };
export const QUIET = { initialFocus: false, finalFocus: false };
