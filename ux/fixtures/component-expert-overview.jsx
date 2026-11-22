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
const DONE = { label: 'Done · 2 live this month', items: [{ id: 'd1', title: 'Price list', meta: 'Live since 4 November' }, { id: 'd2', title: 'Quote page' }], onOpenItem: id => window.__calls.push(`done:${id}`) };
const APPS = [
  { id: 'atelier', name: 'Atelier', line: '3 features · next for you: Thursday', onOpen: call('app:atelier') },
  { id: 'devis', name: 'Devis', unreadable: true },
];
const FEATURES = [
  { id: 'f1', title: 'Quote letters', status: 'Ready for you to try', reached: 3, turn: 'person', line: 'You have looked at 1 of 4 points', action: { label: 'Pick up where you left off', onAction: call('feature:f1') } },
  { id: 'f2', title: 'Client summary', status: 'Agents proving it', reached: 1, turn: 'agents', line: 'Ready for you around Thursday · 3 points for you' },
  { id: 'f3', title: 'Search past letters', status: 'Framed', reached: 1, turn: 'nobody', line: 'Waits until you finish « Quote letters »' },
];

function ForYou() {
  const [dropped, setDropped] = useState([]);
  const all = [
    { id: 'i1', text: 'The quote letters in Atelier are ready for you to try. 4 points to look at.', action: { label: 'Try it', onAction: call('open:i1') } },
    { id: 'i2', text: 'The Atelier assistant asks: when a client has no address on file, should the letter still name one?', action: { label: 'Reply', onAction: call('reply:i2') }, later: { label: 'Later', onLater: () => setDropped(list => [...list, 'i2']) } },
    { id: 'i3', text: 'The price list in Devis is ready for you to try.', action: { label: 'Try it', onAction: call('open:i3') } },
    { id: 'i4', text: 'Devis needs a word from you on the VAT line of a quote.', action: { label: 'Open', onAction: call('open:i4') } },
    { id: 'i5', text: 'A last small question about the footer of the quote page.', action: { label: 'Open', onAction: call('open:i5') } },
  ];
  return <ExpertOverview heading="Good evening" intro="Two small things when you have a moment. Everything else is moving on its own." needsYou={all.filter(item => !dropped.includes(item.id))} apps={APPS} done={DONE} />;
}

const Page = () => state === 'track'
  ? <ExpertTrack title="Atelier" subtitle="Release R0 · 3 features" steps={STEPS} note="You act at the first step (say what you want) and the last (check it). Agents do the middle." features={FEATURES}
      done={{ ...DONE, label: 'Accepted · 2 features live' }} extra={{ label: 'Something else is wrong', onAction: call('extra') }} onBack={call('back')} labels={{ back: 'For you' }} />
  : state === 'calm'
    ? <ExpertOverview heading="Good evening" needsYou={[]} calm={{ heading: 'Nothing needs you', text: 'The next check for you is « Client summary » in Atelier, around Thursday. It will show here when it is ready.' }} apps={APPS} done={{ ...DONE, label: 'Done · 6 live this month' }} />
    : <ForYou />;

window.__ux = { calls: () => window.__calls.slice() };
createRoot(document.getElementById('root')).render(<main data-testid="surface" className="mx-auto min-h-dvh w-full max-w-md bg-background px-5 py-6 text-foreground"><Page /></main>);
