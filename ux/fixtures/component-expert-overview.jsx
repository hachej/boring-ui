import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExpertOverview, ExpertTrack } from '../../registry/expert-overview/expert-overview.tsx';

// Component scenario `component:expert-overview`: the registry block as an app mounts it, over plain data. The app writes every sentence;
// the block only draws them. Fictional: two apps, « Atelier » and « Devis », and invented titles.
// Query: dark=1, pace (ignored), s=for-you (default: five items passed, the block shows three) | track | calm.
// `window.__ux`: calls (what the gestures called back), so a flow can read it.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const state = params.get('s') ?? 'for-you';
window.__calls = [];
const call = name => () => { window.__calls.push(name); };

const STEPS = [{ id: 'framed', label: 'Framed' }, { id: 'proven', label: 'Proven' }, { id: 'rehearsed', label: 'Rehearsed' }, { id: 'accepted', label: 'Accepted' }];
const DONE = { label: 'Done · 2 live', items: [{ id: 'd1', title: 'Price list', meta: 'Live since 4 Nov' }, { id: 'd2', title: 'Quote page' }], onOpenItem: id => window.__calls.push(`done:${id}`) };
const APPS = [
  { id: 'atelier', name: 'Atelier', line: '3 features · next: Thursday', onOpen: call('app:atelier') },
  { id: 'devis', name: 'Devis', unreadable: true },
];
const FEATURES = [
  { id: 'f1', title: 'Quote letters', status: 'Ready to try', reached: 3, turn: 'person', line: '1 of 4 points seen', action: { label: 'Continue', onAction: call('feature:f1') } },
  { id: 'f2', title: 'Client summary', status: 'In progress', reached: 1, turn: 'agents', line: 'Ready around Thursday' },
  { id: 'f3', title: 'Search past letters', status: 'Waiting', reached: 1, turn: 'nobody', line: 'After Quote letters' },
];

function ForYou() {
  const [dropped, setDropped] = useState([]);
  const all = [
    { id: 'i1', text: 'Quote letters are ready to try.', action: { label: 'Try it', onAction: call('open:i1') } },
    { id: 'i2', text: 'Atelier asks: name a client with no address?', action: { label: 'Reply', onAction: call('reply:i2') }, later: { label: 'Later', onLater: () => setDropped(list => [...list, 'i2']) } },
    { id: 'i3', text: 'The price list is ready to try.', action: { label: 'Try it', onAction: call('open:i3') } },
    { id: 'i4', text: 'Devis asks about the VAT line.', action: { label: 'Open', onAction: call('open:i4') } },
    { id: 'i5', text: 'One last question on the footer.', action: { label: 'Open', onAction: call('open:i5') } },
  ];
  return <ExpertOverview heading="Good evening" needsYou={all.filter(item => !dropped.includes(item.id))} apps={APPS} done={DONE} />;
}

const Page = () => state === 'track'
  ? <ExpertTrack title="Atelier" subtitle="Release R0 · 3 features" steps={STEPS} note="You act first and last." features={FEATURES}
      done={{ ...DONE, label: 'Accepted · 2 features live' }} extra={{ label: 'Something else is wrong', onAction: call('extra') }} onBack={call('back')} labels={{ back: 'For you' }} />
  : state === 'calm'
    ? <ExpertOverview heading="Good evening" needsYou={[]} calm={{ heading: 'Nothing needs you', text: 'Next: Client summary, around Thursday.' }} apps={APPS} done={{ ...DONE, label: 'Done · 6 live this month' }} />
    : <ForYou />;

window.__ux = { calls: () => window.__calls.slice() };
createRoot(document.getElementById('root')).render(<main data-testid="surface" className="mx-auto min-h-dvh w-full max-w-md bg-background px-5 py-6 text-foreground"><Page /></main>);
