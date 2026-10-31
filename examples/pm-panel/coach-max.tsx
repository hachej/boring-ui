// The fictional « Coach Max » app of the row C boards (Alice, « Déjeuner 520 kcal · 32 g »…): the app's own markup, not the kit's.
// Shared by the fixture page (host-wired PM) and the one-line app (`panel={pmPanel({ agent: 'pm' })}`).
import type { CSSProperties, ReactNode } from 'react';
import { useScreenHeader } from '../../registry/app-shell/header';
import { Input } from '../app-shell/components/ui/input';

export const note = (name: string, value: unknown) => { const global = window as unknown as Record<string, unknown[]>; (global[name] ??= []).push(value); };
const query = new URLSearchParams(location.search);

const ink = { color: 'var(--foreground)' } as const;
const card: CSSProperties = { border: '1px solid var(--border)', borderRadius: 14, padding: 14 };
const label: CSSProperties = { fontSize: 12, letterSpacing: '0.08em', color: 'var(--coach-subtle)' };
const row: CSSProperties = { fontSize: 14, display: 'flex', justifyContent: 'space-between', padding: '6px 0' };
function Page({ title, subtitle, children }: { readonly title: string; readonly subtitle: string; readonly children: ReactNode }) {
  useScreenHeader({ title, subtitle, titleFace: 'sans' });
  return <section data-feedback-visible="" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, ...ink }}>{children}</section>;
}
function Day() {
  return <Page title="Ma journée" subtitle="mer. 28 oct.">
    <div style={card}>
      <div style={label}>REPAS</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontStyle: 'italic', margin: '2px 0 10px' }}>PLAN DU JOUR</div>
      <div style={row}><span>Petit-déjeuner 08:00</span><span>~0 kcal</span></div>
      <div role="article" aria-label="Déjeuner" data-testid="card-a" onClick={() => note('__activated', 'a')} style={{ borderRadius: 10, padding: 8, margin: '6px -8px' }}>
        <div style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', fontWeight: 650 }}><span>{query.has('long') ? 'Déjeuner fictif · très longue étiquette '.repeat(15) : 'Déjeuner'}</span><span>520 kcal · 32 g</span></div>
        <div style={{ fontSize: 13, marginTop: 2 }}>Salade de lentilles, œuf</div>
      </div>
      <div style={row}><span>Dîner 20:00</span><span>—</span></div>
    </div>
    <div role="meter" aria-label="Protéines" aria-valuenow={229} aria-valuemin={0} aria-valuemax={130} data-testid="gauge" onClick={() => note('__activated', 'gauge')} style={card}>
      <div style={label}>PROTÉINES</div>
      <div style={{ fontSize: 14, marginTop: 6 }}>229 / 130 g · 176 %</div>
    </div>
    <div style={card}>
      <div style={label}>SÉANCE</div>
      <div style={{ fontSize: 14, marginTop: 6 }}>Haut du corps · 18:00</div>
    </div>
    {query.has('case') && <Input data-testid="domain-draft" aria-label="Brouillon de la page" defaultValue="Brouillon fictif" />}
    {/* A heading and a mark with no name of its own (spec 1 §3: such a pick is labelled with the nearest heading). */}
    {query.has('case') && Array.from({ length: 12 }, (_, index) => <div key={index} style={card}><h3 style={{ ...label, margin: 0, fontWeight: 400 }}>REPÈRE {index + 1}</h3><div style={{ fontSize: 14, marginTop: 6 }}><span data-testid={`mark-${index + 1}`} style={{ display: 'inline-block', width: 10, height: 10, marginRight: 6, borderRadius: 5, background: 'currentColor' }} />Le contenu reste accessible en défilant.</div></div>)}
    <button type="button" data-testid="last-action" onClick={() => note('__activated', 'last')} style={{ ...card, background: 'transparent', font: 'inherit', fontSize: 14, textAlign: 'left', minHeight: 44, ...(query.has('case') || query.has('scroll') ? {} : { display: 'none' }) }}>Dernière action de la page</button>
  </Page>;
}
function Progress() {
  return <Page title="Progrès" subtitle="7 derniers jours">
    <div role="article" aria-label="Poids" data-testid="card-b" onClick={() => note('__activated', 'b')} style={card}>
      <div style={label}>POIDS</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontStyle: 'italic', margin: '2px 0 10px' }}>72,4 kg</div>
      <svg width="300" height="80" viewBox="0 0 300 80" aria-hidden="true"><polyline points="0,52 50,48 100,54 150,42 200,44 250,36 300,32" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </div>
    <div style={card}><div style={label}>ENTRAÎNEMENT</div><div style={{ fontSize: 14, marginTop: 6 }}>3 séances · 41 séries</div></div>
    <div style={card}><div style={label}>PROTÉINES</div><div style={{ fontSize: 14, marginTop: 6 }}>Moyenne 142 g / jour</div></div>
    <button type="button" data-testid="last-action" onClick={() => note('__activated', 'last')} style={{ ...card, background: 'transparent', font: 'inherit', fontSize: 14, textAlign: 'left', minHeight: 44, ...(query.has('case') || query.has('scroll') ? {} : { display: 'none' }) }}>Dernière action de la page</button>
  </Page>;
}
function Plain({ title, subtitle }: { readonly title: string; readonly subtitle: string }) {
  return <Page title={title} subtitle={subtitle}><div style={card}><div style={label}>{title.toUpperCase()}</div><div style={{ fontSize: 14, marginTop: 6 }}>Rien de prévu.</div></div></Page>;
}
const NoIcon = () => null;


/** The app's navigation and account menu, as the boards show them. */
export const coachNav = [
  { id: 'day', label: 'Ma journée', icon: NoIcon, render: () => <Day /> },
  { id: 'progress', label: 'Progrès', icon: NoIcon, render: () => <Progress /> },
  { id: 'session', label: 'Séance', icon: NoIcon, render: () => <Plain title="Séance" subtitle="Haut du corps · 18:00" /> },
  { id: 'data', label: 'Données', icon: NoIcon, render: () => <Plain title="Données" subtitle="Export et partage" /> },
];
export const coachAccount = { name: 'Alice', email: 'alice@exemple.fr', menu: [{ label: 'Réglages', onSelect: () => note('__menu', 'settings') }, { label: 'Accueil du coach', onSelect: () => note('__menu', 'coach') }], signOut: () => note('__menu', 'out') };
