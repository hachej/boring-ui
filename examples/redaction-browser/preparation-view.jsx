import React, { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { ExperienceRenderer } from '@hachej/boring-ui-kit/experience';
import { randomUUID } from '@hachej/boring-files/platform';
import { preparationSections, preparationSlots } from '../redaction/preparation-schema.mjs';
import { preparationCells } from './preparation-composition.mjs';

const Context = createContext(null);
const usePreparation = () => useContext(Context);
function Header() { const { read } = usePreparation(); return <header data-preparation-header><h2>{read.kind === 'available' ? read.document.header : 'Preparation header unavailable'}</h2></header>; }
function Synthesis() { const { read } = usePreparation(); return <section data-preparation-synthesis><h2>Synthèse</h2><p>{read.kind === 'available' ? read.document.synthesis : 'Preparation content unavailable'}</p></section>; }
function Notes() { return usePreparation().notes; }
function Actions() { return usePreparation().actions; }
function Schedule() { const { read } = usePreparation(); return <section data-preparation-schedule><h2>Échéances</h2>{read.kind === 'available' ? <ul>{read.document.schedule.map((item, index) => <li key={index}>{item.label} – {item.at}</li>)}</ul> : <p>Schedule unavailable</p>}</section>; }
function Heading({ section }) { return <h2 data-clinical-section={section.id}>{section.title}</h2>; }
function Card({ slot }) {
  const { read, disclosures, toggle } = usePreparation(), card = read.kind === 'available' && read.document.cards.find(card => card.itemId === slot.itemId);
  if (!card) return <article data-preparation-card={slot.itemId}><p role="status">Preparation item unavailable</p></article>;
  const expanded = disclosures.has(slot.itemId);
  return <article data-preparation-card={slot.itemId} data-section={slot.section} data-kind={slot.kind}><h3>{card.title}</h3><p>{card.summary}</p><p data-clinical-status>{card.status}</p>
    <button type="button" aria-label={`Details ${slot.itemId}`} aria-expanded={expanded} onClick={() => toggle(slot.itemId)}>{expanded ? '−' : '+'}</button>
    {expanded && <ul>{card.details.map((detail, index) => <li key={index}>{detail.text} – {detail.status}</li>)}</ul>}
    <small data-provenance style={{ fontSize: '16px' }}>Source: {read.document.sources.dossier.resource.path} · revision {read.document.sources.dossier.revision}</small>
  </article>;
}
const fixed = { 'preparation/header': Header, 'preparation/synthesis': Synthesis, 'preparation/notes': Notes, 'preparation/actions': Actions, 'preparation/schedule': Schedule };
const renderers = new Map(Object.entries(fixed));
for (const section of preparationSections) renderers.set(`preparation/section-${section.id}`, () => <Heading section={section} />);
for (const slot of preparationSlots) renderers.set(slot.ref, () => <Card slot={slot} />);
const cells = preparationCells.map(cell => ({ ...cell, render: renderers.get(cell.ref) ?? (() => <p>Registered preparation cell unavailable</p>) }));
function Toolbar({ preparation }) {
  const state = useSyncExternalStore(preparation.subscribe, preparation.getSnapshot, preparation.getSnapshot), layout = useSyncExternalStore(preparation.controller.subscribe, preparation.controller.getSnapshot, preparation.controller.getSnapshot);
  const [error, setError] = useState(''), pending = layout.save.kind === 'pending', unknown = layout.save.kind === 'settled' && layout.save.result.kind === 'unknown';
  const act = action => { setError(''); Promise.resolve().then(action).then(result => { if (result && !['saved', 'applied', 'committed', 'admitted', 'proposed', 'available'].includes(result.kind)) setError(result.reason ?? result.kind); }).catch(() => setError('Operation unavailable; current state retained')); };
  return <section data-preparation-toolbar>{layout.readOnly && <p role="status">Read-only default layout; reopen to reacquire layout access.</p>}<output role="status">{state.status}</output>
    <button disabled={state.preparing || state.requestUncertain} onClick={() => act(preparation.prepare)}>Prepare selected notes</button>
    <button onClick={() => act(preparation.observe)}>Observe preparation</button>
    {state.requestUncertain && <button disabled={state.preparing} onClick={() => act(preparation.retry)}>Retry original preparation</button>}
    <button disabled={layout.readOnly || state.read.kind !== 'available'} onClick={() => act(() => preparation.compose('request'))}>Arrange preparation</button>
    {state.composition && <button onClick={preparation.cancel}>Cancel arrangement</button>}
    {state.offer && <><button onClick={() => act(preparation.adopt)}>Use preparation arrangement</button><button onClick={preparation.reject}>Dismiss preparation arrangement</button></>}
    {layout.pin && <button disabled={layout.readOnly || pending || unknown} onClick={() => act(() => preparation.controller.actions.pin(layout.pin.selection))}>Pin preparation</button>}
    <button disabled={layout.readOnly || !layout.dirty || pending || unknown} onClick={() => act(() => preparation.controller.flush(preparation.controller.actions.selection()))}>Keep preparation layout</button>
    <button disabled={!unknown} onClick={() => act(preparation.controller.actions.reconcile)}>Reconcile preparation layout</button>
    <button disabled={pending || unknown} onClick={() => act(preparation.controller.actions.refresh)}>Refresh preparation layout</button>
    {layout.remote && <button disabled={pending || unknown} onClick={() => act(preparation.controller.actions.discardToRemote)}>Discard preparation layout draft</button>}
    <output role="status" data-preparation-outcome>{state.outcome?.kind ?? 'No preparation admitted'}</output>
    {layout.save.kind === 'settled' && layout.save.result.kind === 'saved' && <code data-layout-receipt>{layout.save.result.receipt.operationId}</code>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
export function PreparationExperience({ owner, notes, actions }) {
  const preparation = owner.preparation, state = useSyncExternalStore(preparation.subscribe, preparation.getSnapshot, preparation.getSnapshot), layout = useSyncExternalStore(preparation.controller.subscribe, preparation.controller.getSnapshot, preparation.controller.getSnapshot);
  const width = state.width, disclosures = new Set(state.disclosures);
  useLayoutEffect(() => { preparation.mounted(randomUUID()); return () => preparation.mounted(null); }, [preparation]);
  const canView = ref => !preparationSlots.some(slot => slot.ref === ref) || !['denied', 'unavailable'].includes(state.read.kind);
  const toggle = preparation.toggleDetail;
  return <section data-boring="preparation-experience" style={{ fontSize: '16px' }}><label>Preparation column width<input aria-label="Preparation column width" type="range" min="40" max="100" value={width} onChange={event => preparation.setWidth(Number(event.target.value))} /></label>
    <Toolbar preparation={preparation} /><div data-preparation-column style={{ width: `${width}%` }}><Context value={{ read: state.read, notes, actions, disclosures, toggle }}>
      {layout.descriptor ? <ExperienceRenderer descriptor={layout.descriptor} cells={cells} canView={canView} /> : <p role="status">Preparation layout unavailable</p>}
    </Context></div>
  </section>;
}
