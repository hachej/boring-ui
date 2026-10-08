import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { captureAnnotation, createAnnotation, fetchSaveEndpoint } from '@hachej/boring-feedback/ui';
import { APP, startFeedbackApp } from '../../examples/feedback/server.mjs';

// The composed examples/feedback app driven headlessly for the FEEDBACK-n runtime proofs (WP9): its real routes over HTTP, its
// store, and its builder agent through `app.say` (the chat route's mention resolution, then a native submission). The browser side is
// the real `@hachej/boring-feedback/ui` capture and Save code on a HappyDOM copy of the page's structure. Fictional data only.

export const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname.startsWith('/settings/') ? '/settings/:section' : pathname });
export const PAGE = `<div id="fernhill-app"><main data-feedback-visible=""><h1>Workspace settings</h1>
  <form><button type="submit" data-feedback-id="save-profile" data-testid="save-profile">Save profile</button><input id="studio-name" value="Fernhill Ceramics"></form>
  <section data-testid="exports"><div><button type="button" class="fh-btn">Export CSV</button></div><div><button type="button" class="fh-btn">Export CSV</button></div></section></main>
  <aside><p>Mara Quill paid invoice F-2210</p></aside></div>`;

/** A started app (no browser assets) and its data directory, closed after the test. */
export async function openApp(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-contract-'));
  const app = await startFeedbackApp({ directory, assets: false, ...options });
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  return app;
}

/** A HappyDOM page with the Fernhill structure, closed after the test. */
export function openPage(t, html = PAGE) {
  const window = new Window({ url: 'http://fernhill.invalid/settings/profile?q=hidden#frag', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  window.document.body.innerHTML = html;
  t.after(() => window.happyDOM.close());
  return { window, document: window.document, root: window.document.getElementById('fernhill-app') };
}

/** The person's authorized fetch, as the page does it. */
export const authorized = (app, person) => request => {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${app.people[person].token}`);
  return fetch(new Request(request, { headers }));
};
export const api = async (app, person, path, init = {}) => {
  const response = await authorized(app, person)(new Request(new URL(path, app.url), init));
  return { status: response.status, body: await response.json() };
};

/** The browser path: capture `elements` on `page`, write `said`, Save through the app's route. Returns the annotation and its save. */
export async function annotateAndSave(app, person, page, elements, said) {
  const capture = await captureAnnotation({ app: APP, build: 'dev-contract', policy, root: page.root }, elements);
  const annotation = createAnnotation({ capture, save: fetchSaveEndpoint(new URL('/api/feedback', app.url), authorized(app, person)), copyText: async () => true });
  annotation.setSaid(said);
  return { annotation, saved: await annotation.save() };
}

/** The tool results of a turn, parsed, in order. */
const parsed = text => { try { return JSON.parse(text); } catch { return { text }; } };
/** Tool results by name; a result that is not JSON (Pi's own file tools answer in text) is `{ text }`. */
export const toolResults = messages => messages.filter(message => message.role === 'toolResult').map(message => ({ name: message.toolName, value: parsed(message.content.map(part => part.text ?? '').join('\n')) }));
export const replyText = messages => messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text)).join('\n');
