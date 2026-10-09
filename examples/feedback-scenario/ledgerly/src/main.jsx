// Ledgerly's feedback mount, step A: annotation only. Feedback, notes, Copy report; no store, no agent, no chat. Ledgerly has no chat
// composer, so a minimal stand-in takes its place: the composer's Feedback button (same test id) and its chip, whose review offers
// Copy report. The components are the ones the shadcn CLI copied into src/components/feedback/ from the `feedback` registry item;
// the logic comes from the installed @hachej/boring-feedback. Everything feedback renders sits outside the application root and is marked
// data-feedback-ignore.
//
// "Open a copied report" is the annotation-only way to see where a report points: paste a report copied earlier, and its pins are
// placed on this page (the optional FeedbackReport component).
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { FeedbackBar, FeedbackChip, NoteBubble, useComposerFeedback } from './components/feedback/feedback-session';
import { FeedbackReport } from './components/feedback/feedback-report';
import { pickerOverlayStyles, usePickerOverlay } from './components/feedback/picker-overlay';
import { LedgerPage } from './ledger/LedgerPage.jsx';
import './index.css';
import './app.css';

// The one widening: the route template, so ids in the path never leave the page. It is recorded in every report.
const policy = createPrivacyPolicy({
  routeOf: ({ pathname }) => /^\/books\/[^/]+\/accounts\/[^/]+\/?$/.test(pathname) ? '/books/:bookId/accounts/:accountId' : pathname,
});
const appRoot = () => document.getElementById('ledgerly-app');

function PastedReport({ overlay, onClose }) {
  const [text, setText] = useState('');
  const [opened, setOpened] = useState(null);
  const open = () => {
    const parsed = parseFeedback(new TextEncoder().encode(text.trim() + '\n'));
    setOpened(parsed.ok ? { report: parsed.report } : { problem: parsed.problems.map(problem => `${problem.at}: ${problem.message}`).join('; ') });
  };
  return <div className="ly-panel" data-boring="feedback" data-feedback-ignore="" data-testid="feedback-paste-panel">
    <label className="ly-field"><span>Paste a copied report</span>
      <textarea data-testid="feedback-paste" rows={4} value={text} onChange={event => setText(event.target.value)} /></label>
    <div className="ly-actions">
      <button type="button" className="boring-feedback-button" data-testid="feedback-paste-open" onClick={open}>Open</button>
      <button type="button" className="boring-feedback-button" onClick={() => { overlay?.clear(); onClose(); }}>Close</button>
    </div>
    {opened?.problem && <p role="alert" data-testid="feedback-paste-problem">{opened.problem}</p>}
    {opened?.report && <FeedbackReport key={opened.report.id} report={opened.report} page={{ root: appRoot, policy, overlay }} />}
  </div>;
}

/** The stand-in for a chat composer: its Feedback button and, after Done, the chip with Copy report in its review. */
function ComposerStandIn({ session }) {
  const feedback = useComposerFeedback(session);
  if (!feedback) return null;
  return <span className="ly-composer" data-boring="feedback">
    {feedback.pending ? <FeedbackChip session={session} copy />
      : <button type="button" className="boring-feedback-button" data-testid="composer-feedback" aria-pressed={feedback.active} disabled={feedback.active} onClick={feedback.start}>Feedback</button>}
  </span>;
}

function App() {
  const overlay = usePickerOverlay();
  const [session, setSession] = useState(null);
  const [pasting, setPasting] = useState(false);
  useEffect(() => {
    const created = createFeedbackSession({ app: 'ledgerly', build: 'scenario-dev', policy, root: appRoot(), styles: pickerOverlayStyles });
    setSession(created);
    return () => created.dispose();
  }, []);
  return <>
    <LedgerPage />
    {session && <FeedbackBar session={session} />}
    {session && <NoteBubble session={session} />}
    <div className="ly-dock" data-feedback-ignore="">
      {session && <ComposerStandIn session={session} />}
      <button type="button" className="ly-btn" data-testid="feedback-open-copied" onClick={() => { overlay?.clear(); setPasting(open => !open); }}>Open a copied report</button>
    </div>
    {pasting && <PastedReport overlay={overlay} onClose={() => setPasting(false)} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
