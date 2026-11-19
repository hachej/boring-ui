import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SignInPage } from '../../registry/sign-in/sign-in.tsx';
import { say } from '../../packages/ui/src/signin/words.ts';
import { COACH_MAX_THEME } from './coach-max-theme.mjs';

// Component scenario `component:sign-in`: the registry block's SignInPage alone, over a fake Worker (`window.fetch` answers in this page: no network, no key).
// The refusals are the kit's own sentences (`say` of the Worker's words), so a change to a refusal shows here.
// Query: dark=1 (dark theme), lang=en (English, French by default), first-owner=<token> (the page opened from the one-use link; the token decides the
// Worker's answer: `valid`, `used` or `unknown`, and `late-` before it answers after 2 s), pace (ignored).
// The theme is Coach Max's: a lime primary on paper, which is what the switch links must not be drawn in.
// `window.__ux`: mark(testid) and moved(testid) (how far a box left its marked place), leaks() (every moment the owner's sign-up showed before the Worker
// said the link was good, read after every change of the page), answered() (the Worker has answered the link's check), waited() (the wait was on screen).
const params = new URLSearchParams(location.search);
const lang = params.get('lang') === 'en' ? 'en' : 'fr';
const dark = params.get('dark') === '1';
document.documentElement.lang = lang;
if (dark) document.documentElement.classList.add('dark');
const theme = document.createElement('style');
theme.textContent = COACH_MAX_THEME;
document.head.append(theme);

const RIGHT_PASSWORD = 'harbor-garage-1';
const SLOW_MS = 700, LATE_MS = 2000;
const token = params.get('first-owner') ?? '';
const late = token.startsWith('late-'), good = token.replace(/^late-/, '') === 'valid';
const state = { answered: false, goodAnswered: false, leaks: [], waited: false, marks: {} };

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refusal = (code, status) => reply({ code, message: say(code, lang) }, status);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
window.fetch = async (input, init = {}) => {
  const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
  const body = init.body ? JSON.parse(init.body) : {};
  if (path === '/api/signin/options') return reply({ google: true, studio: false, app: 'Harbor Garage (fictional)' });
  if (path === '/api/signin/first-owner') {
    if (late) await pause(LATE_MS);
    state.answered = true; state.goodAnswered = good;
    return reply({ valid: good });
  }
  if (path === '/api/auth/sign-in/email') { await pause(SLOW_MS); return body.password === RIGHT_PASSWORD ? reply({}) : refusal('INVALID_EMAIL_OR_PASSWORD', 401); }
  if (path === '/api/auth/sign-up/email') { await pause(SLOW_MS); return reply({}); }
  return reply({}, 404);
};

// The owner's sign-up (its lead, or its form with no switch link) is on screen: it may show only once the Worker said the link is good.
const ownerShows = () => /Vous installez|You are setting up/.test(document.getElementById('root').textContent) || Boolean(document.querySelector('#sign-in-name') && !document.querySelector('[data-testid=sign-in-switch]'));
const look = () => {
  if (document.querySelector('[data-testid=sign-in-first-owner-wait]')) state.waited = true;
  if (ownerShows() && !state.goodAnswered) state.leaks.push(`${Math.round(performance.now())} ms: the owner's sign-up shows before the link was confirmed`);
};
new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

const box = testid => { const b = document.querySelector(`[data-testid=${testid}]`).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; };
window.__ux = {
  mark: testid => { state.marks[testid] = box(testid); },
  moved: testid => Math.max(...box(testid).map((v, i) => Math.abs(v - state.marks[testid][i]))),
  leaks: () => state.leaks.length, answered: () => state.answered, waited: () => state.waited,
};

const App = () => {
  const [done, setDone] = useState(false);
  return done
    ? <main data-testid="signed-in" className="mx-auto mt-24 grid w-full max-w-sm grid-cols-1 gap-1 px-4">
      <h1 className="m-0 text-xl font-semibold">{lang === 'fr' ? 'Bienvenue' : 'Welcome'}</h1>
      <p className="m-0 text-sm text-muted-foreground">Julie Harbor (fictional)</p>
    </main>
    : <SignInPage locale={lang} onSignedIn={() => setDone(true)} />;
};
createRoot(document.getElementById('root')).render(<App />);
