'use client';

// A diagram drawn as an SVG and a legend: nodes in layers by distance from the first node, one arrow per edge with a numbered badge, and a
// numbered legend under it that says what happens and who acts (labels of any length). Layers run left to right while they fit the box; in
// a narrow box (a phone) they run top to bottom instead. A diagram still wider than its box scrolls inside it, never the page. A node's
// group is a muted second line in its box. No layout library: the layered layout is a breadth-first pass over the edges.
import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Diagram } from './diagram';

const H1 = 44, H2 = 54, W_WIDE = 148, GX = 72, GY = 36, VX = 16, VY = 56, LOOP = 36;

type Point = { readonly x: number; readonly y: number };

/** Each node's layer: the shortest number of edges from the first node; nodes it never reaches come after, one layer each. */
function layers(diagram: Diagram): Map<number, string[]> {
  const { nodes, edges } = diagram;
  const depth = new Map<string, number>([[nodes[0]!.id, 0]]);
  for (let changed = true, guard = 0; changed && guard < 50; guard++) {
    changed = false;
    for (const edge of edges) if (depth.has(edge.from) && !depth.has(edge.to)) { depth.set(edge.to, depth.get(edge.from)! + 1); changed = true; }
  }
  let extra = Math.max(0, ...depth.values()) + 1;
  for (const node of nodes) if (!depth.has(node.id)) depth.set(node.id, extra++);
  const columns = new Map<number, string[]>();
  for (const node of nodes) { const d = depth.get(node.id)!; columns.set(d, [...(columns.get(d) ?? []), node.id]); }
  return columns;
}

/** The SVG path of an edge and where its number sits. */
function arrow(a: Point, b: Point, W: number, H: number, vertical: boolean): { d: string; x: number; y: number } {
  if (!vertical) {
    // Next layer: right edge to left edge. Same layer, below: straight down. Otherwise (back, or skipping a layer): a loop under both boxes.
    const kind = b.x > a.x && b.x - a.x <= W + GX ? 'forward' : b.x === a.x && b.y > a.y ? 'down' : 'back';
    const x1 = kind === 'forward' ? a.x + W : a.x + W / 2, y1 = kind === 'forward' ? a.y + H / 2 : a.y + H;
    const x2 = kind === 'forward' ? b.x : b.x + W / 2, y2 = kind === 'forward' ? b.y + H / 2 : kind === 'down' ? b.y : b.y + H;
    const d = kind === 'forward' ? `M${x1} ${y1} C${x1 + GX / 2} ${y1} ${x2 - GX / 2} ${y2} ${x2} ${y2}` : kind === 'down' ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${y1 + 30} ${x2} ${y2 + 30} ${x2} ${y2}`;
    return { d, x: kind === 'down' ? x1 + 12 : (x1 + x2) / 2, y: kind === 'back' ? Math.max(y1, y2) + 22 : (y1 + y2) / 2 };
  }
  // Next layer: bottom edge to top edge. Same row: side to side. Otherwise (back, or skipping a layer): a loop on the right.
  const kind = b.y > a.y && b.y - a.y <= H + VY ? 'forward' : b.y === a.y ? 'across' : 'back';
  const right = b.x > a.x;
  const x1 = kind === 'forward' ? a.x + W / 2 : kind === 'across' ? (right ? a.x + W : a.x) : a.x + W, y1 = kind === 'forward' ? a.y + H : a.y + H / 2;
  const x2 = kind === 'forward' ? b.x + W / 2 : kind === 'across' ? (right ? b.x : b.x + W) : b.x + W, y2 = kind === 'forward' ? b.y : b.y + H / 2;
  const out = Math.max(x1, x2) + LOOP - 8;
  const d = kind === 'forward' ? `M${x1} ${y1} C${x1} ${y1 + VY / 2} ${x2} ${y2 - VY / 2} ${x2} ${y2}` : kind === 'across' ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${out} ${y1} ${out} ${y2} ${x2} ${y2}`;
  return { d, x: kind === 'back' ? out - 6 : (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

const clip = (text: string, fit: number) => text.length > fit ? `${text.slice(0, fit - 1)}…` : text;

/** The words the view needs (a maquette's labels have them too). */
export interface DiagramViewLabels { readonly transitionBy: (by: string) => string }

/**
 * The diagram and its legend. `highlight`: node ids of a path (the diagram's own `path` by default), drawn stronger with the arrows between
 * consecutive nodes of it.
 */
export function DiagramView({ diagram, highlight = diagram.path, labels }: { readonly diagram: Diagram; readonly highlight?: readonly string[]; readonly labels: DiagramViewLabels }) {
  const { nodes, edges, groups } = diagram;
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const marker = `diagram-arrow-${useId().replace(/:/g, '')}`;
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
  const H = nodes.some(node => node.group) ? H2 : H1;
  const columns = layers(diagram);
  const count = Math.max(...columns.keys()) + 1, widest = Math.max(...[...columns.values()].map(ids => ids.length));
  const vertical = room > 0 && 16 + count * W_WIDE + (count - 1) * GX > room;
  const W = vertical ? Math.max(104, Math.min(W_WIDE, Math.floor((room - 16 - LOOP - (widest - 1) * VX) / widest))) : W_WIDE;
  const pos = new Map<string, Point>();
  for (const [d, ids] of columns) ids.forEach((id, i) => pos.set(id, vertical ? { x: 8 + i * (W + VX), y: 8 + d * (H + VY) } : { x: 8 + d * (W + GX), y: 8 + i * (H + GY) }));
  const points = [...pos.values()];
  const width = (vertical ? LOOP : 16) + Math.max(...points.map(p => p.x)) + W + 8, height = (vertical ? 16 : 40) + Math.max(...points.map(p => p.y)) + H;
  const on = new Set(highlight);
  const steps = new Set(highlight.slice(1).map((id, i) => `${highlight[i]}\n${id}`));
  const lit = (from: string, to: string) => steps.has(`${from}\n${to}`);
  const label = (id: string) => nodes.find(node => node.id === id)?.label ?? id;
  const groupLabel = (id: string | undefined) => id ? groups.find(group => group.id === id)?.label ?? id : '';
  const fit = Math.floor((W - 16) / 7);
  return <div data-testid="diagram-view" className="flex min-w-0 flex-col gap-4">
    <div ref={box} data-testid="diagram" data-layout={vertical ? 'vertical' : 'horizontal'} className="min-w-0 overflow-x-auto">
      <svg role="img" aria-label={nodes.map(node => node.label).join(' → ')} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="fill-muted-foreground" /></marker></defs>
        {edges.map((edge, i) => {
          const path = arrow(pos.get(edge.from)!, pos.get(edge.to)!, W, H, vertical);
          const strong = lit(edge.from, edge.to);
          return <g key={i} data-edge={`${edge.from}→${edge.to}`} data-lit={strong || undefined}>
            <path d={path.d} fill="none" className={strong ? 'stroke-primary' : 'stroke-muted-foreground/60'} strokeWidth={strong ? 2 : 1.25} markerEnd={`url(#${marker})`} />
            <circle cx={path.x} cy={path.y} r="9" className={strong ? 'fill-primary stroke-primary' : 'fill-background stroke-border'} />
            <text x={path.x} y={path.y + 3.5} textAnchor="middle" fontSize="10" className={strong ? 'fill-primary-foreground' : 'fill-foreground'}>{i + 1}</text>
          </g>;
        })}
        {nodes.map(node => {
          const p = pos.get(node.id)!, strong = on.has(node.id), group = groupLabel(node.group);
          return <g key={node.id} data-node={node.id} data-group={node.group} data-lit={strong || undefined}>
            <rect x={p.x} y={p.y} width={W} height={H} rx="10" className={strong ? 'fill-primary/10 stroke-primary' : 'fill-card stroke-border'} strokeWidth={strong ? 2 : 1} />
            <text x={p.x + W / 2} y={p.y + (group ? 22 : H / 2 + 4)} textAnchor="middle" fontSize="12" className="fill-foreground">{clip(node.label, fit)}<title>{node.label}</title></text>
            {group && <text x={p.x + W / 2} y={p.y + 40} textAnchor="middle" fontSize="10" className="fill-muted-foreground">{clip(group, fit + 2)}</text>}
          </g>;
        })}
      </svg>
    </div>
    {edges.length > 0 && <ol data-testid="diagram-legend" className="m-0 grid list-none gap-x-6 gap-y-2 p-0 text-sm sm:grid-cols-2">
      {edges.map((edge, i) => <li key={i} className="flex min-w-0 items-start gap-2">
        <Badge variant={lit(edge.from, edge.to) ? 'default' : 'outline'} className="tabular-nums">{i + 1}</Badge>
        <span className="min-w-0 text-pretty"><span className="font-medium">{label(edge.from)} → {label(edge.to)}</span>{edge.label && <>: {edge.label}</>}
          {edge.by && <span className="text-muted-foreground"> ({labels.transitionBy(edge.by)})</span>}</span>
      </li>)}
    </ol>}
    {diagram.note && <p data-testid="diagram-note" className="m-0 text-sm text-pretty text-muted-foreground">{diagram.note}</p>}
  </div>;
}
