// The fictional application page people leave feedback on. Header, navigation and `main` are marked `data-feedback-visible`, so their
// text may leave the page; the activity panel is not, so its text is masked. Form values are always masked. Some elements carry
// `data-testid` or `data-feedback-id`; the two Export buttons come from one component on purpose, so a pin on one is ambiguous.
// `saveLabel` is the page state the fictional builder changes; the banner can be dismissed, so a pin on it can go missing.
// Two sections, `/settings/profile` (the default for any other path) and `/settings/billing`, switch in the page with pushState
// (`onNavigate`), so one route template `/settings/:section` covers both.
import { useState } from 'react';
import { ExportButton } from './ExportButton.jsx';
import { ActivityPanel } from './ActivityPanel.jsx';

const NAV = ['Projects', 'Library', 'Team', 'Billing'];

const SECTIONS = [['profile', 'Profile'], ['billing', 'Billing']];

/** The section of a settings path: `billing` for `/settings/billing`, otherwise `profile`. */
export const sectionOf = pathname => /^\/settings\/billing\/?$/.test(pathname) ? 'billing' : 'profile';

function Billing() {
  const [plan, setPlan] = useState('Studio');
  const [menu, setMenu] = useState(false);
  return <section className="fh-card" data-testid="billing">
    <h2>Plan</h2>
    <div className="fh-row"><span><strong data-testid="billing-plan">{plan} plan</strong> <small>Renews on the first of each month.</small></span>
      <button type="button" className="fh-btn" data-feedback-id="change-plan" data-testid="change-plan" aria-expanded={menu} onClick={() => setMenu(open => !open)}>Change plan</button></div>
    {menu && <div className="fh-menu" role="menu" data-testid="plan-menu">
      {['Starter', 'Studio', 'Workshop'].map(name => <button key={name} type="button" role="menuitem" className="fh-btn" onClick={() => { setPlan(name); setMenu(false); }}>{name}</button>)}
    </div>}
    <div className="fh-row"><span><strong>Invoices</strong> <small>Sent to the contact email.</small></span>
      <button type="button" className="fh-btn" data-testid="download-invoices">Download all</button></div>
  </section>;
}

export function SettingsPage({ saveLabel = 'Save profile', section = 'profile', onNavigate = () => {} }) {
  const [banner, setBanner] = useState(true);
  const [saved, setSaved] = useState('');
  const [exported, setExported] = useState('');
  const [presses, setPresses] = useState(0);
  return <div className="fh-app" id="fernhill-app" data-testid="app-root">
    <header className="fh-header" data-feedback-visible="">
      <span className="fh-brand"><span className="fh-logo" aria-hidden="true" />Fernhill Studio</span>
      <nav aria-label="Main" className="fh-nav" data-feedback-visible="">
        {NAV.map(name => <a key={name} href="#" onClick={event => event.preventDefault()}>{name}</a>)}
        <a href="#" aria-current="page" onClick={event => event.preventDefault()}>Settings</a>
      </nav>
    </header>
    <div className="fh-body">
      <main className="fh-main" data-feedback-visible="">
        <h1>Workspace settings</h1>
        <p className="fh-lede">How your fictional studio workspace looks, notifies and exports.</p>
        <nav aria-label="Settings sections" className="fh-tabs" data-testid="settings-sections">
          {SECTIONS.map(([id, name]) => <a key={id} href={`/settings/${id}`} data-testid={`section-${id}`} aria-current={section === id ? 'page' : undefined}
            onClick={event => { event.preventDefault(); onNavigate(`/settings/${id}`); }}>{name}</a>)}
        </nav>
        {section === 'billing' ? <Billing /> : <>
        {banner && <div className="fh-banner" data-testid="beta-banner">
          <strong data-feedback-id="email-exports-banner" data-testid="email-exports-banner">New: send exports by email.</strong>
          <button type="button" className="fh-btn">Try email exports</button>
          <button type="button" className="fh-btn" data-testid="dismiss-banner" onClick={() => setBanner(false)}>Dismiss</button>
        </div>}
        <form className="fh-card" data-testid="profile-form" onSubmit={event => { event.preventDefault(); setPresses(count => count + 1); setSaved('Profile saved'); }}>
          <h2>Profile</h2>
          <div className="fh-field"><label htmlFor="studio-name">Studio name</label><input id="studio-name" defaultValue="Fernhill Ceramics" /></div>
          <div className="fh-field"><label htmlFor="studio-email">Contact email</label><input id="studio-email" type="email" defaultValue="hello@fernhill.invalid" /></div>
          <div className="fh-actions">
            <button type="submit" className="fh-btn primary" data-feedback-id="save-profile" data-testid="save-profile">{saveLabel}</button>
            <span className="fh-note" role="status" data-testid="profile-saved" data-presses={presses}>{saved}</span>
          </div>
        </form>
        <section className="fh-card" data-testid="notifications">
          <h2>Notifications</h2>
          {[['weekly', 'Weekly digest'], ['orders', 'New orders'], ['mentions', 'Mentions']].map(([id, name], index) =>
            <label className="fh-row" key={id}><span>{name}</span><input type="checkbox" role="switch" data-testid={`notify-${id}`} defaultChecked={index !== 1} /></label>)}
        </section>
        <section className="fh-card" data-testid="exports">
          <h2>Exports</h2>
          {[['Invoices', 'Every invoice of the year.'], ['Receipts', 'Card receipts, one row each.']].map(([name, hint]) =>
            <div className="fh-row" key={name}><span><strong>{name}</strong> <small>{hint}</small></span><ExportButton onExport={() => setExported(`${name} exported`)} /></div>)}
          <p className="fh-note" role="status" data-testid="exported">{exported}</p>
        </section>
        </>}
      </main>
      <ActivityPanel />
    </div>
  </div>;
}
