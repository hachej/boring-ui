import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AppShell } from '../../registry/app-shell/app-shell';
import { Inbox } from '../../registry/_shared/icons';
import { Button } from '@/components/ui/button';
import { isDark, setDark, setLocale, useDark, useLocale } from './kit';
import type { Locale } from './kit';
import { Foundations } from './foundations';
import { Level1 } from './level1';

/** Demos that the iframe embeds render alone (`window.__EMBED__.name`), each in its own viewport. */
function ShellDemo() {
  const [route, setRoute] = useState('orders');
  const locale = useLocale();
  const page = (title: string, rows: readonly string[]): ReactNode => <div className="flex flex-col gap-2 p-3">
    <h3 className="text-[length:var(--text-title)] font-semibold">{title}</h3>
    {rows.map(row => <div key={row} className="rounded-md bg-card px-3 py-2 text-xs">{row}</div>)}
  </div>;
  const nav = [
    { id: 'orders', label: 'Orders', icon: Inbox, render: () => page('Orders', ['A-1041 · Atelier Lumen · Paid', 'A-1042 · Maison Orme · Pending', 'A-1043 · Studio Vallon · Late']) },
    { id: 'clients', label: 'Clients', icon: Inbox, render: () => page('Clients', ['Atelier Lumen', 'Maison Orme', 'Studio Vallon']) },
  ];
  return <AppShell layout="screen" title="Atelier" nav={nav} route={{ id: route, onChange: setRoute }} locale={locale}
    account={{ name: 'Camille Durand', email: 'camille@example.test', menu: [], theme: { value: isDark() ? 'dark' : 'light', onChange: value => setDark(value === 'dark') } }} />;
}

const embeds: Record<string, () => ReactNode> = { shell: () => <div className="gx-fixed-shell h-full"><ShellDemo /></div> };

const SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['foundations', 'Foundations'],
  ['level1', 'Level 1'],
];

function Chrome() {
  const dark = useDark();
  const locale = useLocale();
  return <div className="gx-doc">
    <header className="gx-top">
      <div className="gx-top-in">
        <nav className="gx-nav" aria-label="Sections">{SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        <Button variant="outline" size="sm" aria-pressed={locale === 'fr'} onClick={() => setLocale(locale === 'en' ? 'fr' : 'en')}>{locale === 'en' ? 'FR' : 'EN'}</Button>
        <Button variant="outline" size="sm" aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'}</Button>
      </div>
    </header>
    <main>
      <h1 className="pt-6 text-[length:var(--text-title)] font-semibold">Boring design system, default style v1</h1>
      <p className="gx-lead">Every component below is the real kit. Fictional data only. Each card names its block and the tokens it reads.</p>
      <Foundations />
      <Level1 />
    </main>
  </div>;
}

function App() {
  const embedName = (window as unknown as { __EMBED__?: { name: string } }).__EMBED__?.name;
  if (embedName) return <div className="gx-embed-root h-full">{embeds[embedName]?.() ?? null}</div>;
  return <Chrome />;
}

window.addEventListener('message', event => {
  const gallery = (event.data as { gallery?: { dark: boolean; locale: Locale } } | null)?.gallery;
  if (!gallery) return;
  document.documentElement.classList.toggle('dark', gallery.dark);
  setLocale(gallery.locale);
});

try {
  if (localStorage.getItem('gallery-dark') === '1') document.documentElement.classList.add('dark');
} catch { /* storage may be blocked */ }

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
