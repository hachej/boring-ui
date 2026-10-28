// The one-line app (spec 2, « App API: one line »): Coach Max adds « Améliorer l’app » with `improve={{ agent: 'pm' }}` and nothing else.
// No controller, transport, transcription or identity code: the kit opens the app's PM door (the fake of hachej/boring-factory#854).
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AppShell } from '../../registry/app-shell/app-shell';
import { coachAccount, coachNav } from './coach-max';

function App() {
  const [screen, setScreen] = useState('day');
  return <AppShell layout="screen" title="Coach Max" locale="fr" route={{ id: screen, onChange: setScreen }} account={coachAccount} nav={coachNav}
    improve={{ agent: 'pm' }} />;
}
createRoot(document.getElementById('root')!).render(<App />);
