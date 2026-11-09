import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as block from '../../../registry/agent-bar/agent-bar.tsx';

const { AgentBar, AgentStatus, AgentQuestion } = block;

// D-1978 slice 1: the agent bar (field, mic, send, quoted chip) and the status line above it, over a fictional day page, with a fake microphone
// and a fake transcriber (fictional text). `?dark=1` picks the dark theme; `?status=working|done` shows the status line; `?quoted=1` cites a row; `?live=1` streams the words (see below); `?slow=1` makes the transcription take 1.5s; `?deny=1` refuses the microphone.
// Slice 2: `?question=1|2|3` opens the question card (1: where the tart comes from, answering moves to 2; 2: the portion, answering closes it; 3: a confirm card whose choices answer at once)
// and `?question=info` mounts the answer card (« Max répond », no hint) beside the bar; each answer lands in window.__answered, and « Plus tard » in window.__later.
// What the app would see is on window: __sent (onSend payloads), __transcribed (blobs handed to transcribe), __cancelled (status Annuler),
// __cleared (quoted ✕), __history (history taps), __tracks (microphone tracks released).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
// The host's theme sets the card's two variables (a lime-like fill, dark ink) the way an app would, so the shots compare with the boards.
document.documentElement.style.setProperty('--agent-question', 'oklch(0.92 0.19 122)');
document.documentElement.style.setProperty('--agent-question-foreground', 'oklch(0.2 0 0)');
window.__sent = []; window.__transcribed = []; window.__answered = []; window.__later = 0; window.__cancelled = 0; window.__cleared = 0; window.__history = 0; window.__tracks = { opened: 0, released: 0 };

// The fake microphone: getUserMedia hands out a stream with one track that counts its release; MediaRecorder hands over one chunk when it stops.
// Web Audio is removed so the kit's capture takes the MediaRecorder path on this stream.
Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
  if (params.get('deny') === '1') throw new DOMException('Permission denied', 'NotAllowedError');
  window.__tracks.opened += 1;
  let stopped = false;
  const track = { stop() { if (!stopped) { stopped = true; window.__tracks.released += 1; } } };
  return { getTracks: () => [track], getAudioTracks: () => [track] };
} } });
class FakeRecorder extends EventTarget {
  static isTypeSupported() { return true; }
  constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    const chunk = new Event('dataavailable'); chunk.data = new Blob(['fictional audio'], { type: 'audio/webm' }); this.dispatchEvent(chunk);
    this.dispatchEvent(new Event('stop'));
  }
}
window.MediaRecorder = FakeRecorder;

// `?live=1` hands the bar a live stream instead of `transcribe`: a fictional provider that says nothing by itself. The page (the test) plays it through
// window.__sink (`partial(text)`, `final(text)`) and reads window.__stream ({ opened, stopped, cancelled }).
window.__stream = { opened: 0, stopped: 0, cancelled: 0 };
const stream = async sink => { window.__sink = sink; window.__stream.opened += 1; return { stop: async () => { window.__stream.stopped += 1; }, cancel: () => { window.__stream.cancelled += 1; } }; };

const transcribe = async audio => { window.__transcribed.push(audio.size); await new Promise(done => setTimeout(done, params.get('slow') === '1' ? 1500 : 60)); return 'Au goûter une part de tarte aux pommes'; };
const meals = [['Petit-déjeuner', 420, ['Flocons d’avoine 60 g', 'Lait demi-écrémé 200 ml']], ['Midi', 820, ['Riz cuit 200 g', 'Poulet grillé 150 g']], ['Goûter', 2, ['Tarte aux pommes · 1 part', 'Café noir 1 tasse']]];

const later = () => { window.__later += 1; };
const cards = {
  '1': answer => ({ step: 'Tarte · 1 sur 2', title: 'D’où vient la tarte ?', choices: ['Boulangerie', 'Maison', 'Supermarché'], preselected: 'Boulangerie', onAnswer: answer, onLater: later }),
  '2': answer => ({ step: 'Tarte · 2 sur 2', answered: 'Boulangerie', title: 'La part faisait…', choices: ['Fine', 'Normale', 'Généreuse'], preselected: 'Normale', submit: 'Valider', onAnswer: answer, onLater: later }),
  '3': answer => ({ step: 'Tarte', note: 'Tu as dit : « C’est une tarte fine en fait »', title: 'Tarte fine : 230 kcal la part.', choices: ['Oui, corrige', 'Non, normale'], preselected: 'Oui, corrige', submit: null, onAnswer: answer }),
};
const info = { step: 'Max répond', note: 'Tu as demandé : « combien de calories dans une tarte aux pommes ? »', title: 'Tarte aux pommes', details: [{ label: '1 part (≈ 120 g)', value: '≈ 285 kcal' }, { label: 'Pour 100 g', value: '≈ 237 kcal' }, { label: 'Tarte entière (8 parts)', value: '≈ 2 280 kcal' }], footnote: 'CIQUAL + étiquettes · rien n’est noté', choices: ['Ajouter une part', 'Fermer'], preselected: 'Ajouter une part', submit: null, onAnswer: answer => { window.__answered.push(answer); } };

const Day = () => {
  const [card, setCard] = useState(params.get('question'));
  const answer = value => { window.__answered.push(value); setCard(current => current === '1' ? '2' : null); };
  const [quoted, setQuoted] = useState(params.get('quoted') === '1' ? 'Tarte aux pommes' : undefined);
  const [open, setOpen] = useState(false);
  window.__clearQuoted = () => setQuoted(undefined);
  const status = params.get('status');
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <main className="flex flex-1 flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">Lundi 9 novembre</p>
      <p className="text-4xl font-semibold">1 240 <span className="text-base font-medium text-muted-foreground">/ 2 100 kcal</span></p>
      <div className="flex gap-2"><Button data-testid="host-button" variant="outline">Hôte</Button><Input data-testid="host-input" defaultValue="Hôte" aria-label="Champ hôte" /></div>
      {meals.map(([title, kcal, rows]) => <section key={title} className="flex flex-col gap-1.5 rounded-xl bg-card p-3">
        <h2 className="flex justify-between text-sm font-semibold"><span>{title}</span><span>{kcal}</span></h2>
        {rows.map(row => <p key={row} className="rounded-lg bg-background p-3 text-sm">{row}</p>)}
      </section>)}
    </main>
    <div data-testid="dock" className="flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-6">
      {status ? <AgentStatus state={status} text={status === 'working' ? 'Max compte la tarte…' : 'Tarte vérifiée : 285 kcal'} onCancel={() => { window.__cancelled += 1; }} /> : null}
      {card === 'info' ? <AgentQuestion question={info} hint={false} /> : null}
      <AgentBar {...(params.get('live') === '1' ? { stream } : { transcribe })} onSend={payload => { window.__sent.push(payload); }} historyOpen={open}
        {...(params.get('badge') ? { historyBadge: { label: 'Question en attente' } } : {})}
        {...(card && card !== 'info' ? { question: cards[card](answer) } : {})}
        onHistory={() => { window.__history += 1; setOpen(value => !value); }}
        {...(quoted ? { quoted: { label: quoted, onClear: () => { window.__cleared += 1; setQuoted(undefined); } } } : {})} />
    </div>
  </div>;
};
createRoot(document.getElementById('root')).render(<Day />);
