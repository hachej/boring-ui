'use client';

// The workflow diagram: states in columns by distance from the first state, one arrow per transition with a numbered badge, and a legend
// under it that says what happens and who acts (labels of any length). Columns run left to right while they fit the box; in a narrow box
// (a phone) the steps run top to bottom instead. A diagram still wider than its box scrolls inside it, never the page.
import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { MaquetteWorkflow } from './maquette';
import type { MaquetteLabels } from './maquette-labels';

const H = 44, W_WIDE = 148, GX = 72, GY = 36, VX = 16, VY = 56, LOOP = 36;

type Point = { readonly x: number; readonly y: number };

/** Each state's step: the shortest number of transitions from the first state; states it never reaches come after, one step each. */
function steps(workflow: MaquetteWorkflow): Map<number, string[]> {
  const { states, transitions } = workflow;
  const depth = new Map<string, number>([[states[0]!.id, 0]]);
  for (let changed = true, guard = 0; changed && guard < 50; guard++) {
    changed = false;
    for (const t of transitions) if (depth.has(t.from) && !depth.has(t.to)) { depth.set(t.to, depth.get(t.from)! + 1); changed = true; }
  }
  let extra = Math.max(0, ...depth.values()) + 1;
  for (const s of states) if (!depth.has(s.id)) depth.set(s.id, extra++);
  const columns = new Map<number, string[]>();
  for (const s of states) { const d = depth.get(s.id)!; columns.set(d, [...(columns.get(d) ?? []), s.id]); }
  return columns;
}

/** The SVG path of a transition and where its number sits. */
function arrow(a: Point, b: Point, W: number, vertical: boolean): { d: string; x: number; y: number } {
  if (!vertical) {
    // Next step: right edge to left edge. Same column, below: straight down. Otherwise (back, or skipping a step): a loop under both boxes.
    const kind = b.x > a.x && b.x - a.x <= W + GX ? 'forward' : b.x === a.x && b.y > a.y ? 'down' : 'back';
    const x1 = kind === 'forward' ? a.x + W : a.x + W / 2, y1 = kind === 'forward' ? a.y + H / 2 : a.y + H;
    const x2 = kind === 'forward' ? b.x : b.x + W / 2, y2 = kind === 'forward' ? b.y + H / 2 : kind === 'down' ? b.y : b.y + H;
    const d = kind === 'forward' ? `M${x1} ${y1} C${x1 + GX / 2} ${y1} ${x2 - GX / 2} ${y2} ${x2} ${y2}` : kind === 'down' ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${y1 + 30} ${x2} ${y2 + 30} ${x2} ${y2}`;
    return { d, x: kind === 'down' ? x1 + 12 : (x1 + x2) / 2, y: kind === 'back' ? Math.max(y1, y2) + 22 : (y1 + y2) / 2 };
  }
  // Next step: bottom edge to top edge. Same row: side to side. Otherwise (back, or skipping a step): a loop on the right.
  const kind = b.y > a.y && b.y - a.y <= H + VY ? 'forward' : b.y === a.y ? 'across' : 'back';
  const right = b.x > a.x;
  const x1 = kind === 'forward' ? a.x + W / 2 : kind === 'across' ? (right ? a.x + W : a.x) : a.x + W, y1 = kind === 'forward' ? a.y + H : a.y + H / 2;
  const x2 = kind === 'forward' ? b.x + W / 2 : kind === 'across' ? (right ? b.x : b.x + W) : b.x + W, y2 = kind === 'forward' ? b.y : b.y + H / 2;
  const out = Math.max(x1, x2) + LOOP - 8;
  const d = kind === 'forward' ? `M${x1} ${y1} C${x1} ${y1 + VY / 2} ${x2} ${y2 - VY / 2} ${x2} ${y2}` : kind === 'across' ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${out} ${y1} ${out} ${y2} ${x2} ${y2}`;
  return { d, x: kind === 'back' ? out - 6 : (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/** The diagram and its legend. `highlight`: the states of the case on display, drawn stronger with the transitions between them. */
export function MaquetteDiagram({ workflow, highlight, labels }: { readonly workflow: MaquetteWorkflow; readonly highlight: readonly string[]; readonly labels: MaquetteLabels }) {
  const { states, transitions } = workflow;
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const marker = `maquette-arrow-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const measure = () => setRoom(element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns = steps(workflow);
  const count = Math.max(...columns.keys()) + 1, widest = Math.max(...[...columns.values()].map(ids => ids.length));
  const vertical = room > 0 && 16 + count * W_WIDE + (count - 1) * GX > room;
  const W = vertical ? Math.max(104, Math.min(W_WIDE, Math.floor((room - 16 - LOOP - (widest - 1) * VX) / widest))) : W_WIDE;
  const pos = new Map<string, Point>();
  for (const [d, ids] of columns) ids.forEach((id, i) => pos.set(id, vertical ? { x: 8 + i * (W + VX), y: 8 + d * (H + VY) } : { x: 8 + d * (W + GX), y: 8 + i * (H + GY) }));
  const points = [...pos.values()];
  const width = (vertical ? LOOP : 16) + Math.max(...points.map(p => p.x)) + W + 8, height = (vertical ? 16 : 40) + Math.max(...points.map(p => p.y)) + H;
  const on = new Set(highlight);
  const label = (id: string) => states.find(s => s.id === id)?.label ?? id;
  const fit = Math.floor((W - 16) / 7);
  return <div className="flex min-w-0 flex-col gap-4">
    <div ref={box} data-testid="maquette-diagram" data-layout={vertical ? 'vertical' : 'horizontal'} className="min-w-0 overflow-x-auto">
      <svg role="img" aria-label={states.map(s => s.label).join(' → ')} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="fill-muted-foreground" /></marker></defs>
        {transitions.map((t, i) => {
          const path = arrow(pos.get(t.from)!, pos.get(t.to)!, W, vertical);
          const lit = on.has(t.from) && on.has(t.to);
          return <g key={i} data-lit={lit || undefined}>
            <path d={path.d} fill="none" className={lit ? 'stroke-primary' : 'stroke-muted-foreground/60'} strokeWidth={lit ? 2 : 1.25} markerEnd={`url(#${marker})`} />
            <circle cx={path.x} cy={path.y} r="9" className={lit ? 'fill-primary stroke-primary' : 'fill-background stroke-border'} />
            <text x={path.x} y={path.y + 3.5} textAnchor="middle" fontSize="10" className={lit ? 'fill-primary-foreground' : 'fill-foreground'}>{i + 1}</text>
          </g>;
        })}
        {states.map(s => {
          const p = pos.get(s.id)!, lit = on.has(s.id);
          return <g key={s.id} data-state={s.id} data-lit={lit || undefined}>
            <rect x={p.x} y={p.y} width={W} height={H} rx="10" className={lit ? 'fill-primary/10 stroke-primary' : 'fill-card stroke-border'} strokeWidth={lit ? 2 : 1} />
            <text x={p.x + W / 2} y={p.y + H / 2 + 4} textAnchor="middle" fontSize="12" className="fill-foreground">{s.label.length > fit ? `${s.label.slice(0, fit - 1)}…` : s.label}<title>{s.label}</title></text>
          </g>;
        })}
      </svg>
    </div>
    {transitions.length > 0 && <ol data-testid="maquette-legend" className="m-0 list-none p-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {transitions.map((t, i) => <li key={i} className="flex min-w-0 items-start gap-2">
        <Badge variant={on.has(t.from) && on.has(t.to) ? 'default' : 'outline'} className="tabular-nums">{i + 1}</Badge>
        <span className="min-w-0 text-pretty"><span className="font-medium">{label(t.from)} → {label(t.to)}</span>{t.label && <>: {t.label}</>}
          {t.by && <span className="text-muted-foreground"> ({labels.transitionBy(t.by)})</span>}</span>
      </li>)}
    </ol>}
  </div>;
}
