import atlas from '../atlas/composer-atlas.json';

const states = atlas.states;
const byId = new Map(states.map(state => [state.id, state]));
const numbered = atlas.transitions.map((transition, index) => ({ ...transition, number: index + 1 }));
// The diagram: one per group, the group's states on an ellipse, the states they lead to (of another group) muted, one arrow per pair of states numbered as in the table.
const NODE = { w: 190, h: 34 };
function edgePoint(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const k = Math.min(dx === 0 ? Infinity : NODE.w / 2 / Math.abs(dx), dy === 0 ? Infinity : NODE.h / 2 / Math.abs(dy));
  return { x: from.x + dx * k, y: from.y + dy * k };
}
export function Diagram({ group }) {
  const own = states.filter(state => state.group === group).map(state => state.id);
  const inside = numbered.filter(transition => transition.from !== transition.to && own.includes(transition.from) && own.includes(transition.to));
  // A group that is mostly arrows to and from another group (the signals on the bar) shows those states too, muted.
  const wanted = inside.length >= own.length ? inside : numbered.filter(transition => transition.from !== transition.to && (own.includes(transition.from) || own.includes(transition.to)));
  const edges = new Map();
  for (const transition of wanted) {
    const key = `${transition.from}>${transition.to}`;
    edges.set(key, { from: transition.from, to: transition.to, numbers: [...(edges.get(key)?.numbers ?? []), transition.number] });
  }
  const ids = [...new Set([...own, ...[...edges.values()].flatMap(edge => [edge.from, edge.to])])];
  const rx = Math.max(200, ids.length * 34), ry = Math.max(90, ids.length * 16);
  const width = rx * 2 + NODE.w + 40, height = ry * 2 + NODE.h + 40;
  const at = new Map(ids.map((id, i) => { const angle = -Math.PI / 2 + (2 * Math.PI * i) / ids.length; return [id, { x: width / 2 + rx * Math.cos(angle), y: height / 2 + ry * Math.sin(angle) }]; }));
  return <div data-testid={`atlas-diagram-${group.toLowerCase().replace(/\W+/g, '-')}`} className="overflow-x-auto rounded-(--radius-lg) bg-card ring-1 ring-border">
    <svg role="img" aria-label={`States and transitions of ${group}`} viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-180 w-full text-muted-foreground">
      <defs><marker id="atlas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="fill-current" /></marker></defs>
      {[...edges.values()].map(edge => {
        const a = at.get(edge.from), b = at.get(edge.to);
        const start = edgePoint(a, b), end = edgePoint(b, a);
        const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2, nx = -(end.y - start.y), ny = end.x - start.x, len = Math.hypot(nx, ny) || 1;
        const bend = 26, cx = mx + (nx / len) * bend, cy = my + (ny / len) * bend, lx = (start.x + 2 * cx + end.x) / 4, ly = (start.y + 2 * cy + end.y) / 4;
        const text = edge.numbers.join(',');
        return <g key={`${edge.from}>${edge.to}`} data-edge={`${edge.from}>${edge.to}`}>
          <path d={`M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`} fill="none" strokeWidth="1.5" markerEnd="url(#atlas-arrow)" className="stroke-current" />
          <rect x={lx - 4 - text.length * 3.5} y={ly - 9} width={8 + text.length * 7} height="18" className="fill-background stroke-border" />
          <text x={lx} y={ly + 4} textAnchor="middle" className="fill-foreground text-xs font-medium">{text}</text>
        </g>;
      })}
      {ids.map(id => {
        const p = at.get(id), state = byId.get(id), muted = !own.includes(id);
        return <g key={id} data-node={id}>
          <rect x={p.x - NODE.w / 2} y={p.y - NODE.h / 2} width={NODE.w} height={NODE.h} strokeDasharray={muted ? '4 3' : undefined} className={muted ? 'fill-muted stroke-border' : 'fill-card stroke-primary'} strokeWidth="1.5" />
          <text x={p.x} y={p.y + 4} textAnchor="middle" className={`text-xs font-medium ${muted ? 'fill-muted-foreground' : 'fill-foreground'}`}>{state.name}</text>
        </g>;
      })}
    </svg>
  </div>;
}

