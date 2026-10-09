// Browser side of the feedback demo: the fictional Fernhill settings page and the AmbientChat agent bar in one page. By default the
// bar's composer has the one entry point, **Feedback** (FEEDBACK.md, "UX"): feedback mode on this page (FeedbackBar, NoteBubble from
// registry/feedback over `createFeedbackSession`), then one chip in the composer (FeedbackChip with its review); Send saves the
// report and attaches it as an `@feedback/<id>.md` mention, which the server inlines. Voice uses `createVoiceCapture` and
// `/api/transcribe`. `?ui=classic` mounts the Release 1 surfaces instead (PointButton, AnnotateSheet, FeedbackList, FeedbackReport),
// which stay in the registry item as optional components. Everything feedback renders is outside the application root and marked
// `data-feedback-ignore`, so it is never picked or serialized. `?save=0` stores nothing: Send inlines the report (and the classic UI
// copies only), the FEEDBACK-5 annotation-only configuration. The builder's (builder.mjs) `feedback` results render as the pi-chat
// feedback card, whose element lines highlight in this page on hover and resolve on click (show-outcome.mjs). `/assistant` mounts the
// same chat with no page, so the card says `unavailable` there. `?canaries=1` plants the WP3 canary kit in the application root for
// the whole visit; the journey scans everything it produced and calls `window.__feedbackCanaries.finish(outputs)`.
// Preview (FEEDBACK.md, "Preview"): when the builder's `browser_preview` call is pending in this person's conversation, the page runs
// the preview subagent (`@hachej/boring-feedback/preview`) on the `/api/llm` gateway models (model-preview.mjs, no key in the page) over the
// report's pins, shows PreviewBanner, and answers the call through the chat transport (`remote.answer`) on Approve or Discard.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createPrivacyPolicy, createVoiceCapture, runPrivacyCanaries } from '@hachej/boring-feedback/page';
import { captureAnnotation, createAnnotation, createFeedbackSession, fetchSaveEndpoint, showAnchor } from '@hachej/boring-feedback/ui';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createPreviewSession, pendingBrowserTasks } from '@hachej/boring-feedback/preview';
import { GATEWAY_PROVIDER } from '@hachej/boring-agent/gateway-provider';
import { PREVIEW_MODEL, previewModels } from './model-preview.mjs';
import { PreviewBanner } from '../../registry/feedback-preview/preview-banner.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { feedbackRenderTool } from '../../registry/pi-chat/feedback-card.tsx';
import { PointButton } from '../../registry/feedback/point-button.tsx';
import { pickerOverlayStyles, usePickerOverlay } from '../../registry/feedback/picker-overlay.ts';
import { NoteBubble, useComposerFeedback } from '../../registry/feedback/feedback-session.tsx';
import { AnnotateSheet } from '../../registry/feedback/annotate-sheet.tsx';
import { FeedbackList } from '../../registry/feedback/feedback-list.tsx';
import { FeedbackReport } from '../../registry/feedback/feedback-report.tsx';
import { SettingsPage, sectionOf } from './settings/SettingsPage.jsx';
import { pageShow } from './show-outcome.mjs';

const config = window.__FEEDBACK__;
const params = new URLSearchParams(location.search);
const authorized = request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${config.token}`); return fetch(new Request(request, { headers })); };
const api = async path => { const response = await authorized(new Request(new URL(path, location.href))); return response.json(); };

// The application's privacy policy: its route template is the one widening, and it is recorded in every report.
const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname.startsWith('/settings/') ? '/settings/:section' : pathname });
const appRoot = () => document.getElementById('fernhill-app');
const saveEndpoint = params.get('save') === '0' ? undefined : fetchSaveEndpoint(new URL('/api/feedback', location.href), authorized);
const classic = params.get('ui') === 'classic';

/** The host's transcription for voice notes, app code an application replaces: @hachej/boring-feedback only calls this callback and reads
 * `{ text, segments? }` from its answer. Here the recording goes to this example's `/api/transcribe` (transcribe-route.mjs) with the
 * person's own token; the service key stays on the server. */
const transcribe = async (audio, mimeType) => {
  const response = await authorized(new Request(new URL('/api/transcribe', location.href), { method: 'POST', headers: { 'content-type': mimeType }, body: audio }));
  if (!response.ok) throw new Error(`the transcription answered ${response.status}`);
  return response.json();
};

// Dev hook (development builds only): `await __fernhillModel('check feedback')` completes through the `/api/llm` model gateway
// with this page's session; the page holds no model key (model-preview.mjs).
if (process.env.NODE_ENV !== 'production') window.__fernhillModel = async text => {
  const { previewModels, previewComplete } = await import('./model-preview.mjs');
  return previewComplete(previewModels({ getAuth: () => ({ authorization: `Bearer ${config.token}` }) }), text);
};

/** The page's path, changed by the settings sections with pushState (the query, such as ?as=bob, is kept). */
function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const update = () => setPath(location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  const navigate = useCallback(to => { history.pushState(null, '', `${to}${location.search}`); setPath(location.pathname); }, []);
  return [path, navigate];
}

/** Show for anyone in this page (the report panel and the chat's feedback card): resolve against the live page and reveal honestly. */
export const showFeedback = (overlay, anchor, note) => showAnchor({ anchor, root: appRoot(), policy, overlay, note });

// The `@` menu of the bar offers the reports this person may read, as `@feedback/<id>.md` mentions the server inlines.
const mentions = {
  search: async query => {
    const listed = await api('/api/feedback');
    if (listed.kind !== 'available') return [];
    const needle = query.toLowerCase();
    return listed.items.filter(item => !needle || item.id.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle)).map(item => ({ path: `feedback/${item.id}.md`, kind: 'file' }));
  },
};

/** The page's state the builder's `edit_page` changes (polled). */
function usePageCopy() {
  const [copy, setCopy] = useState({ saveLabel: 'Save profile', version: 0 });
  useEffect(() => {
    let stopped = false;
    const poll = () => api('/api/page').then(next => { if (!stopped && next.version !== undefined) setCopy(current => current.version === next.version ? current : next); }).catch(() => {});
    poll();
    const timer = setInterval(poll, 700);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return copy;
}

/** Numbered candidates of an ambiguous Show from the chat: the person chooses one, or none. */
function Chooser({ choice }) {
  if (!choice) return null;
  return <div className="fh-chooser" data-feedback-ignore="" data-testid="show-choose" role="dialog" aria-label="Choose where this feedback points">
    <p>This feedback matches more than one place. Which one?</p>
    {choice.candidates.map(candidate => <button key={candidate.number} type="button" className="fh-btn" data-testid="show-candidate" data-number={candidate.number}
      onClick={() => choice.answer(candidate.number)}>{candidate.number} · {candidate.label}</button>)}
    <button type="button" className="fh-btn" data-testid="show-choose-cancel" onClick={() => choice.answer(undefined)}>None of these</button>
  </div>;
}

// Plants the canary kit in the application root for the whole visit (until the journey calls finish).
if (params.get('canaries') === '1') {
  const plant = () => {
    if (!appRoot()) return void requestAnimationFrame(plant);
    void runPrivacyCanaries({ page: { document, root: appRoot() }, run: (_context, emit) => new Promise(resolve => {
      window.__feedbackCanaries = { finish: outputs => { emit('journey', outputs); resolve(); } };
    }) }).then(result => { window.__feedbackCanaryResult = result; });
  };
  plant();
}

function useChat() {
  const [chat, setChat] = useState(null);
  useEffect(() => {
    let disposed = false, controller;
    (async () => {
      const { conversationId } = await api('/api/conversation');
      const remote = await createRemoteChat({ endpoint: new URL(`/api/chat?conversation=${conversationId}`, location.href), fetch: authorized });
      controller = createNativeChatController({ identity: config.identity, ...remote });
      await controller.connect();
      if (disposed) controller.dispose(); else setChat({ controller, answer: remote.answer });
    })().catch(() => {});
    return () => { disposed = true; controller?.dispose(); };
  }, []);
  return chat;
}

function FeedbackPanel({ overlay, open, onClose, refreshKey }) {
  const [listed, setListed] = useState(null);
  const [report, setReport] = useState(null);
  useEffect(() => {
    if (!open || !saveEndpoint) return;
    api('/api/feedback').then(setListed).catch(() => setListed({ kind: 'unavailable', reason: 'The list could not be loaded.' }));
  }, [open, refreshKey]);
  if (!open) return null;
  const openReport = id => api(`/api/feedback/${id}`).then(read => setReport(read.kind === 'available' ? read.report : null));
  return <div className="fh-panel" data-feedback-ignore="" data-testid="feedback-panel">
    <div className="fh-panel-head"><strong>Feedback</strong><button type="button" className="fh-btn" onClick={() => { overlay?.clear(); onClose(); }}>Close</button></div>
    {!saveEndpoint ? <p className="fh-note">Nothing is stored in this configuration: use Copy report.</p>
      : <FeedbackList items={listed?.kind === 'available' ? listed.items : []} protection={listed?.protection ?? 'protected'} activeId={report?.id}
        {...(listed && listed.kind !== 'available' ? { problem: listed.reason } : {})} onOpen={id => { void openReport(id); }} />}
    {report && <FeedbackReport key={report.id} report={report} page={{ root: appRoot, policy, overlay }} onClose={() => { overlay?.clear(); setReport(null); }} />}
  </div>;
}

/** The same chat outside the application page: feedback cards with no page to show in. */
function Outside() {
  const chat = useChat();
  const card = useMemo(() => feedbackRenderTool({}), []);
  return <div data-testid="assistant-page">
    <p className="fh-lede" style={{ padding: '2rem' }}>Studio assistant, outside the settings page.</p>
    {chat && <AmbientChat controller={chat.controller} labels={{ title: 'Studio assistant' }} storageKey="fernhill.ambient.outside" renderTool={card} mentions={mentions} />}
  </div>;
}

/** The feedback card for this page: element lines highlight on hover and resolve on click (numbered choice when ambiguous). */
function usePageCard(overlay, setChoice) {
  return useMemo(() => feedbackRenderTool({
    onShowFeedback: pageShow({
      read: id => api(`/api/feedback/${id}`),
      show: (anchor, note) => showFeedback(overlay, anchor, note),
      choose: candidates => new Promise(resolve => setChoice({ candidates, answer: number => { setChoice(null); resolve(number); } })),
    }),
    onHideFeedback: () => overlay?.clear(),
  }), [overlay, setChoice]);
}

/** The page's preview session for the builder's pending `browser_preview` call, if any (one at a time). */
function usePreview(chat) {
  const subscribe = useCallback(listener => chat?.controller.subscribe(listener) ?? (() => {}), [chat]);
  const view = useSyncExternalStore(subscribe, () => chat?.controller.getSnapshot().view);
  const pending = pendingBrowserTasks(view)[0];
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!chat || !pending || session?.id === pending.id) return;
    const models = previewModels({ getAuth: () => ({ authorization: `Bearer ${config.token}` }) });
    const created = createPreviewSession({
      task: pending, root: appRoot, policy, models, model: models.getModel(GATEWAY_PROVIDER, PREVIEW_MODEL),
      anchors: async id => { const read = await api(`/api/feedback/${id}`); return read.kind === 'available' ? read.report.anchors : []; },
      answer: chat.answer,
    });
    session?.session.dispose();
    setSession({ id: pending.id, session: created });
    window.__previewSession = created;
    void created.start();
  }, [chat, pending?.id]);
  // The call ended (answered, or the conversation was stopped): drop the banner; dispose reverts anything still previewed.
  useEffect(() => {
    if (!session || pending?.id === session.id) return;
    const timer = setTimeout(() => { session.session.dispose(); setSession(null); }, 1200);
    return () => clearTimeout(timer);
  }, [session, pending?.id]);
  return session?.session ?? null;
}

/** The default page: the composer's Feedback button, feedback mode on this page, one chip, and the chat. */
function App() {
  const overlay = usePickerOverlay();
  const copy = usePageCopy();
  const [path, navigate] = usePath();
  const [choice, setChoice] = useState(null);
  const [session, setSession] = useState(null);
  const chat = useChat();
  const feedbackCard = usePageCard(overlay, setChoice);
  const preview = usePreview(chat);
  useEffect(() => {
    const created = createFeedbackSession({
      app: config.app, build: config.build, root: appRoot(), policy, styles: pickerOverlayStyles, voice: createVoiceCapture(), transcribe,
      ...(saveEndpoint ? { save: saveEndpoint, mention: id => `feedback/${id}.md` } : {}),
    });
    window.__feedbackSession = created;
    setSession(created);
    return () => { created.dispose(); delete window.__feedbackSession; };
  }, []);
  const composerFeedback = useComposerFeedback(session ?? undefined);
  return <>
    <SettingsPage saveLabel={copy.saveLabel} section={sectionOf(path)} onNavigate={navigate} />
    {session && <NoteBubble session={session} />}
    {preview && <PreviewBanner session={preview} />}
    <Chooser choice={choice} />
    <div data-feedback-ignore="" data-testid="agent-bar">
      {chat && <AmbientChat controller={chat.controller} labels={{ title: 'Studio assistant' }} storageKey="fernhill.ambient.position" renderTool={feedbackCard} mentions={mentions} feedback={composerFeedback} />}
    </div>
  </>;
}

/** The Release 1 surfaces (`?ui=classic`): Point, the annotate sheet, the Feedback list and the report with Show. Optional components. */
function ClassicApp() {
  const overlay = usePickerOverlay();
  const copy = usePageCopy();
  const [path, navigate] = usePath();
  const [choice, setChoice] = useState(null);
  const feedbackCard = usePageCard(overlay, setChoice);
  const [sheet, setSheet] = useState(null);
  const [panel, setPanel] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const chat = useChat();
  const onPinned = useCallback(async elements => {
    const capture = await captureAnnotation({ app: config.app, build: config.build, policy, root: appRoot() }, elements);
    const annotation = createAnnotation({ capture, ...(saveEndpoint ? { save: saveEndpoint } : {}) });
    annotation.subscribe(() => { if (annotation.getSnapshot().save.kind === 'saved') setRefreshKey(key => key + 1); });
    setPanel(false);
    setSheet({ annotation, near: elements[0], key: Date.now() });
  }, []);
  const closeSheet = () => { overlay?.clear(); setSheet(null); };
  return <>
    <SettingsPage saveLabel={copy.saveLabel} section={sectionOf(path)} onNavigate={navigate} />
    <div className="fh-dock" data-feedback-ignore="" data-testid="feedback-dock">
      <PointButton root={appRoot} policy={policy} overlay={overlay} onPinned={elements => { void onPinned(elements); }} onCancel={() => overlay?.clear()}>Point</PointButton>
      <button type="button" className="fh-btn" data-testid="feedback-open-list" aria-pressed={panel} onClick={() => { overlay?.clear(); setPanel(open => !open); }}>Feedback</button>
    </div>
    {sheet && <AnnotateSheet key={sheet.key} annotation={sheet.annotation} near={sheet.near} onClose={closeSheet} />}
    <FeedbackPanel overlay={overlay} open={panel} refreshKey={refreshKey} onClose={() => setPanel(false)} />
    <Chooser choice={choice} />
    <div data-feedback-ignore="" data-testid="agent-bar">
      {chat && <AmbientChat controller={chat.controller} labels={{ title: 'Studio assistant' }} storageKey="fernhill.ambient.position" renderTool={feedbackCard} mentions={mentions} />}
    </div>
  </>;
}

createRoot(document.getElementById('root')).render(config.outside ? <Outside /> : classic ? <ClassicApp /> : <App />);
