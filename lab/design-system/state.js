// The page's state lives in memory and in the URL hash. It never touches web storage: Factory shows the page in a sandboxed
// iframe (sandbox="allow-scripts", an opaque origin) where storage throws. The theme stylesheet comes from data.js, so nothing is fetched.
import { useSyncExternalStore } from 'react';
import { LIGHT_SCOPE, layerTheme, scopeLight } from './layers.mjs';

const data = globalThis.BORING_DS;
export const themes = data.themes;
export { LIGHT_SCOPE, scopeLight };

const hashOf = () => { try { return new URLSearchParams(location.hash.slice(1)); } catch { return new URLSearchParams(); } };
const start = hashOf();
let state = {
  mode: start.get('mode') === 'dark' ? 'dark' : 'light',
  theme: themes.some(entry => entry.name === start.get('theme')) ? start.get('theme') : themes[0].name,
  width: start.get('width') === '390' ? '390' : '1280',
  version: 0,
};
const listeners = new Set();

export const isFrame = () => hashOf().has('frame');
export const cellId = () => hashOf().get('cell') ?? '';
export const getState = () => state;
export const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const useDs = () => useSyncExternalStore(subscribe, getState);

/** Applies the state to this document at once (not in an effect), so a reader that runs after the change sees the new tokens. */
function apply() {
  const root = document.documentElement;
  root.classList.toggle('dark', state.mode === 'dark');
  root.style.colorScheme = state.mode;
  const entry = themes.find(item => item.name === state.theme) ?? themes[0];
  const sheet = document.getElementById('ds-theme');
  // The app's theme is laid over the default one: a role it leaves out keeps the default value, in both modes.
  if (sheet) sheet.textContent = layerTheme(themes[0].css, entry === themes[0] ? null : entry.css);
}

function mirror() {
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    for (const key of ['mode', 'theme', 'width']) params.set(key, state[key]);
    history.replaceState(null, '', `#${params.toString()}`);
  } catch { /* the state stays in memory when history refuses */ }
}

function tell() {
  for (const frame of document.querySelectorAll('iframe[data-ds-frame], iframe[data-ds-cell]')) frame.contentWindow?.postMessage({ ds: 'state', mode: state.mode, theme: state.theme }, '*');
}

/** The frame tells its shell what it really shows (read from its own document), because an opaque origin lets the shell read nothing back. */
export function report() {
  if (!isFrame() || cellId()) return;
  const root = document.documentElement;
  const background = getComputedStyle(root).getPropertyValue('--background').trim();
  const applied = { ds: 'applied', dark: root.classList.contains('dark'), theme: state.theme, background, width: innerWidth, sections: document.querySelectorAll('[data-ds-section]').length };
  try { parent.postMessage(applied, '*'); } catch { /* opened on its own */ }
}

export function setState(next, { announce = true } = {}) {
  state = { ...state, ...next, version: state.version + 1 };
  apply();
  mirror();
  for (const listener of listeners) listener();
  if (announce) tell();
  report();
}

/** The inner frame is this same file with the state in the hash: it needs no access to the parent (an opaque origin has none). */
/** A cell (an iframe inside the frame) is the same file again, with the cell's id in its hash. */
// The query makes the URL differ from the frame's and the shell's: the browser does not load a third nested frame of one and the same URL (the cell stayed about:blank).
export const cellUrl = id => `${location.href.split('#')[0].split('?')[0]}?cell=${encodeURIComponent(id)}#${new URLSearchParams({ frame: '1', cell: id, mode: state.mode, theme: state.theme })}`;

export const frameUrl = () => `${location.href.split('#')[0]}#${new URLSearchParams({ frame: '1', mode: state.mode, theme: state.theme })}`;

apply();
addEventListener('message', event => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.ds === 'ready') tell();
  if (message.ds !== 'state') return;
  const next = {};
  if (message.mode === 'dark' || message.mode === 'light') next.mode = message.mode;
  if (themes.some(entry => entry.name === message.theme)) next.theme = message.theme;
  setState(next, { announce: isFrame() });
});
if (isFrame()) {
  try { parent.postMessage({ ds: 'ready' }, '*'); } catch { /* opened on its own */ }
  addEventListener('resize', report);
}
