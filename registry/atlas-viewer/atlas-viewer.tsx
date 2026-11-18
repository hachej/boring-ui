'use client';

// The Atlas viewer (features/atlas.md, `atlas-viewer`): an app's catalogue of screens and states, as `boring-ui-blocks atlas … --out <dir>` shot it,
// read from its index.json. The states grouped by flow in their order, each flow's arrows labelled with the state's `after`; a phone (390) or desktop
// (1280) and light or dark switch; a « changed » or « new » badge from the shoot's `--since`; a click opens one shot large. Props in, no fetch: the host
// gives the index and where the shots are (`shotUrl`), which may be a folder, an R2 route or a CDN.
import { useMemo, useState } from 'react';
import { ArrowRightIcon, MonitorIcon, MoonIcon, SmartphoneIcon, SunIcon } from '../_shared/icons';
import { cn, withDefaults } from '../utils/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/** One shot of a state, as the index writes it. */
export type AtlasShot = {
  readonly viewport: 390 | 1280;
  readonly mode: 'light' | 'dark';
  readonly file: string;
  readonly status?: 'same' | 'changed' | 'new';
  readonly consoleErrors?: readonly string[];
  readonly truncated?: boolean;
};
export type AtlasState = { readonly id: string; readonly page: string; readonly title: string; readonly flow?: string; readonly after?: string; readonly shots: readonly AtlasShot[] };
/** The shoot's index.json (`version: 1`). */
export type AtlasIndex = { readonly version: 1; readonly commit?: string | null; readonly createdAt?: string; readonly states: readonly AtlasState[] };

export type AtlasViewerLabels = {
  readonly screens: string;
  readonly phone: string;
  readonly desktop: string;
  readonly light: string;
  readonly dark: string;
  readonly viewport: string;
  readonly mode: string;
  readonly changed: string;
  readonly new: string;
  readonly noShot: string;
  readonly empty: string;
  readonly errors: (n: number) => string;
};

export const atlasViewerLabels: Record<'fr' | 'en', AtlasViewerLabels> = {
  en: { screens: 'Screens', phone: 'Phone', desktop: 'Desktop', light: 'Light', dark: 'Dark', viewport: 'Size', mode: 'Theme', changed: 'changed', new: 'new',
    noShot: 'No shot at this size', empty: 'No state shot yet', errors: n => `${n} console error${n === 1 ? '' : 's'}` },
  fr: { screens: 'Écrans', phone: 'Téléphone', desktop: 'Ordinateur', light: 'Clair', dark: 'Sombre', viewport: 'Taille', mode: 'Thème', changed: 'modifié', new: 'nouveau',
    noShot: 'Pas de capture à cette taille', empty: 'Aucun état photographié pour le moment', errors: n => `${n} erreur${n === 1 ? '' : 's'} de console` },
};

export type AtlasViewerProps = {
  readonly index: AtlasIndex;
  /** Where a shot's file is: `file => \`${base}/${file}\``. */
  readonly shotUrl: (file: string) => string;
  readonly locale?: 'fr' | 'en';
  readonly labels?: Partial<AtlasViewerLabels>;
  /** The starting size and theme (default phone, light). */
  readonly viewport?: 390 | 1280;
  readonly mode?: 'light' | 'dark';
  readonly className?: string;
};

/** The flows in their order of first appearance, then the states of no flow (`name: null`). */
export function groupAtlas(states: readonly AtlasState[]): { readonly name: string | null; readonly states: readonly AtlasState[] }[] {
  const flows = new Map<string | null, AtlasState[]>();
  for (const s of states) { const k = s.flow ?? null; if (!flows.has(k)) flows.set(k, []); flows.get(k)!.push(s); }
  const loose = flows.get(null);
  flows.delete(null);
  return [...[...flows].map(([name, list]) => ({ name, states: list })), ...(loose ? [{ name: null, states: loose }] : [])];
}

function StatusBadge({ status, labels }: { readonly status?: AtlasShot['status']; readonly labels: AtlasViewerLabels }) {
  if (status !== 'changed' && status !== 'new') return null;
  return <Badge data-testid="atlas-status" data-status={status} variant={status === 'new' ? 'default' : 'secondary'}>{status === 'new' ? labels.new : labels.changed}</Badge>;
}

export function AtlasViewer({ index, shotUrl, locale = 'en', labels: given, viewport: v0 = 390, mode: m0 = 'light', className }: AtlasViewerProps) {
  const labels = withDefaults(atlasViewerLabels[locale], given);
  const [viewport, setViewport] = useState<390 | 1280>(v0);
  const [mode, setMode] = useState<'light' | 'dark'>(m0);
  const [open, setOpen] = useState<{ readonly state: AtlasState; readonly shot: AtlasShot }>();
  const groups = useMemo(() => groupAtlas(index.states), [index]);
  const shotOf = (s: AtlasState) => s.shots.find(x => x.viewport === viewport && x.mode === mode);
  return <div data-testid="atlas-viewer" className={cn('flex h-full min-h-0 flex-col', className)}>
    <div className="flex items-center gap-2 px-2 py-1.5">
      <ToggleGroup value={[String(viewport)]} onValueChange={(v: string[]) => { if (v[0]) setViewport(Number(v[0]) as 390 | 1280); }} size="sm" variant="outline" aria-label={labels.viewport}>
        <ToggleGroupItem value="390" aria-label={labels.phone} title={labels.phone}><SmartphoneIcon /></ToggleGroupItem>
        <ToggleGroupItem value="1280" aria-label={labels.desktop} title={labels.desktop}><MonitorIcon /></ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup value={[mode]} onValueChange={(v: string[]) => { if (v[0]) setMode(v[0] as 'light' | 'dark'); }} size="sm" variant="outline" aria-label={labels.mode}>
        <ToggleGroupItem value="light" aria-label={labels.light} title={labels.light}><SunIcon /></ToggleGroupItem>
        <ToggleGroupItem value="dark" aria-label={labels.dark} title={labels.dark}><MoonIcon /></ToggleGroupItem>
      </ToggleGroup>
      {index.commit && <span data-mono-id className="ml-auto truncate font-mono text-xs text-muted-foreground">{index.commit}</span>}
    </div>
    <Separator />
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-muted p-3">
      {groups.length === 0 && <p className="text-xs text-muted-foreground">{labels.empty}</p>}
      {groups.map(g => <section key={g.name ?? '-'} aria-label={g.name ?? labels.screens} data-testid="atlas-flow">
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{g.name ?? labels.screens}</h3>
        <ol className="flex flex-wrap items-start gap-x-1 gap-y-3">{g.states.map((s, i) => {
          const shot = shotOf(s);
          return <li key={s.id} className="flex items-start gap-1">
            {g.name !== null && i > 0 && <span data-testid="atlas-arrow" className="flex w-16 flex-none flex-col items-center gap-0.5 pt-10 text-center text-xs text-muted-foreground">
              <ArrowRightIcon aria-hidden="true" className="size-3.5" />{s.after ?? ''}</span>}
            <Button variant="outline" data-testid="atlas-state" data-state-id={s.id} disabled={!shot} onClick={() => { if (shot) setOpen({ state: s, shot }); }} aria-label={s.title}
              className={cn('h-auto flex-col items-stretch gap-1 whitespace-normal', viewport === 390 ? 'w-28' : 'w-52')}>
              <span className="relative block overflow-hidden bg-background">
                {shot ? <img src={shotUrl(shot.file)} alt="" loading="lazy" className={cn('w-full object-cover object-top', viewport === 390 ? 'h-48' : 'h-32')} />
                  : <span className="grid h-32 place-items-center px-2 text-center text-xs text-muted-foreground">{labels.noShot}</span>}
                <span className="absolute top-1 right-1"><StatusBadge status={shot?.status} labels={labels} /></span>
              </span>
              <span className="line-clamp-2 text-left text-xs">{s.title}</span>
            </Button>
          </li>;
        })}</ol>
      </section>)}
    </div>
    <Dialog open={open !== undefined} onOpenChange={o => { if (!o) setOpen(undefined); }}>
      <DialogContent data-testid="atlas-large" className="max-h-[90dvh] overflow-y-auto sm:max-w-[min(90vw,72rem)]">
        {open && <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{open.state.title}<StatusBadge status={open.shot.status} labels={labels} /></DialogTitle>
            <DialogDescription>{[open.state.id, open.state.page, String(open.shot.viewport), open.shot.mode,
              ...(open.shot.consoleErrors?.length ? [labels.errors(open.shot.consoleErrors.length)] : [])].join(' · ')}</DialogDescription>
          </DialogHeader>
          <img src={shotUrl(open.shot.file)} alt={open.state.title} className={cn('mx-auto', open.shot.viewport === 390 ? 'w-[390px] max-w-full' : 'w-full')} />
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
