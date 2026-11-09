import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentBar, AgentStatus } from '../../../registry/agent-bar/agent-bar.tsx';

// D-1978 slice 1: the agent bar (field, mic, send, quoted chip) and the status line above it, over a fictional day page, with a fake microphone
// and a fake transcriber (fictional text). `?dark=1` picks the dark theme; `?status=working|done` shows the status line; `?quoted=1` cites a row.
// What the app would see is on window: __sent (onSend payloads), __transcribed (blobs handed to transcribe), __cancelled (status Annuler),
// __cleared (quoted ✕), __history (history taps), __tracks (microphone tracks released).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
window.__sent = []; window.__transcribed = []; window.__cancelled = 0; window.__cleared = 0; window.__history = 0; window.__tracks = { opened: 0, released: 0 };

// The fake microphone: getUserMedia hands out a stream with one track that counts its release; MediaRecorder hands over one chunk when it stops.
// Web Audio is removed so the kit's capture takes the MediaRecorder path on this stream.
Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
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

const transcribe = async audio => { window.__transcribed.push(audio.size); await new Promise(done => setTimeout(done, 60)); return 'Au goûter une part de tarte aux pommes'; };
const meals = [['Petit-déjeuner', 420, ['Flocons d’avoine 60 g', 'Lait demi-écrémé 200 ml']], ['Midi', 820, ['Riz cuit 200 g', 'Poulet grillé 150 g']], ['Goûter', 2, ['Tarte aux pommes · 1 part', 'Café noir 1 tasse']]];

const Day = () => {
  const [quoted, setQuoted] = useState(params.get('quoted') === '1' ? 'Tarte aux pommes' : undefined);
  const [open, setOpen] = useState(false);
  window.__clearQuoted = () => setQuoted(undefined);
  const status = params.get('status');
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <main className="flex flex-1 flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">Lundi 9 novembre</p>
      <p className="text-4xl font-semibold">1 240 <span className="text-base font-medium text-muted-foreground">/ 2 100 kcal</span></p>
      {meals.map(([title, kcal, rows]) => <section key={title} className="flex flex-col gap-1.5 rounded-xl bg-card p-3">
        <h2 className="flex justify-between text-sm font-semibold"><span>{title}</span><span>{kcal}</span></h2>
        {rows.map(row => <p key={row} className="rounded-lg bg-background p-3 text-sm">{row}</p>)}
      </section>)}
    </main>
    <div data-testid="dock" className="flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-6">
      {status ? <AgentStatus state={status} text={status === 'working' ? 'Max compte la tarte…' : 'Tarte vérifiée : 285 kcal'} onCancel={() => { window.__cancelled += 1; }} /> : null}
      <AgentBar transcribe={transcribe} onSend={payload => { window.__sent.push(payload); }} historyOpen={open}
        onHistory={() => { window.__history += 1; setOpen(value => !value); }}
        {...(quoted ? { quoted: { label: quoted, onClear: () => { window.__cleared += 1; setQuoted(undefined); } } } : {})} />
    </div>
  </div>;
};
createRoot(document.getElementById('root')).render(<Day />);
