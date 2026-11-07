import { Badge } from '@boring/ui/shadcn/badge';

const sample = '#fff';
const gradient = 'url(#gradient)';
// dark: bg-black and a hex #123456 in a comment
const note = 'dark:bg-black';

export function FpClean() {
  return (
    <div className="aspect-[4/3] grid-cols-[1fr_auto] z-[60] w-[calc(100%-var(--x))] bg-[color:var(--surface)]">
      <code>#ff0000</code>
      <p>Write dark:bg-black or #fff in your notes.</p>
      <Badge>{sample}</Badge>
      <svg aria-hidden="true"><defs><linearGradient id="gradient" /></defs><rect fill="url(#gradient)" /></svg>
      <span data-note={note} data-gradient={gradient} />
    </div>
  );
}
