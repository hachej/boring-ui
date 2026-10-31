import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ColumnsIcon, ListChecksIcon, MinusIcon, MoonIcon, MousePointer2Icon, SmartphoneIcon } from 'lucide-react';
import { createResourceClient } from '@hachej/boring-files/remote';
import type { ResourceIdentity } from '@hachej/boring-files/remote';
import { appendToDraft, hasMention, mentionToken } from '@hachej/boring-ui-kit/chat-text';
import { taskMentions } from '../../registry/task-mentions/task-mentions';
import { taskFromUrl, taskUrl } from '@hachej/boring-ui-kit/task-board';
import type { TaskFilter, TaskRecord } from '@hachej/boring-ui-kit/task-board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AmbientChat } from '../../registry/pi-ambient/ambient';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat';
import type { ArtifactHostViewApi, PresentedArtifact } from '../../registry/pi-artifacts/artifact';
import { FileViewer } from '../../registry/pi-app/file-viewer';
import { ViewerWindowProvider } from '../../registry/viewer-frame/viewer-frame';
import { markdownKind } from '../../registry/viewer-markdown/markdown-kind';
import { htmlKind } from '../../registry/viewer-html/html-kind';
import { imageKind } from '../../registry/viewer-image/image-kind';
import { TaskBoard, TaskRequestCard } from '../../registry/task-board/task-board';
import type { TaskFileViewApi } from '../../registry/task-board/task-board';
import { confirmation, tasks } from './tasks';

declare global { interface Window { __TASK_BOARD__: { token: string; conversationId: string; identity: ResourceIdentity & { readonly runtimeId: string } } } }
const boot = window.__TASK_BOARD__;
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${boot.token}`); return fetch(new Request(request, { headers })); };
const endpoint = () => new URL('/api/chat', location.href);
const subscribe = (changed: () => void) => { window.addEventListener('popstate', changed); window.addEventListener('boring:task-navigation', changed); return () => { window.removeEventListener('popstate', changed); window.removeEventListener('boring:task-navigation', changed); }; };
const selection = () => taskFromUrl(location.href);
const select = (id: string | null) => { history.pushState(null, '', taskUrl(location.href, id)); window.dispatchEvent(new Event('boring:task-navigation')); };
const params = new URL(location.href).searchParams;
interface HostRequest { readonly artifact: PresentedArtifact; readonly reports?: ArtifactHostViewApi | undefined; readonly mounted: boolean }

/** Only the committed, authorized detail/list reports success; descriptors and open callbacks never do. */
function MountReport({ request, selected, mountedTask }: { readonly request: HostRequest | undefined; readonly selected: string | null; readonly mountedTask?: string }) {
  useEffect(() => {
    if (!request?.mounted || request.artifact.type !== 'task') return;
    const { subject } = request.artifact;
    if ('task' in subject) {
      if (selected !== subject.task) return;
      if (!tasks.some(task => task.id === subject.task)) { request.reports?.onFailed({ subject, reason: subject.task === 'D-403' ? 'Task access denied' : 'Task not found' }); return; }
      if (mountedTask !== subject.task) return;
    } else if (selected !== null || !document.querySelector('[data-task-list]')) return;
    request.reports?.onShown({ subject });
    return () => request.reports?.onShown({ subject, hidden: true });
  }, [request, selected, mountedTask]);
  return null;
}

/** The host's regular viewer in the 760px overlay: « ‹ » back to the task, `D-201 /` breadcrumb, Montrer, zoom and More. */
function TaskFile({ taskId, path, api }: { readonly taskId: string; readonly path: string; readonly api: TaskFileViewApi }) {
  const options = useMemo(() => ({ client: createResourceClient({ endpoint: new URL('/api/resources', location.href), identity: boot.identity, fetch: authorized }), identity: boot.identity, kinds: [markdownKind, htmlKind, imageKind], interactive: { scriptSources: [] } }), []);
  return <div data-host-file={path} data-fullscreen={api.fullscreen} className="h-full min-h-0">
    <ViewerWindowProvider value={{ fullscreen: api.fullscreen, onFullscreenChange: api.onFullscreenChange, actions: api.onShowFile ? [{ id: 'show-file', label: 'Montrer', icon: MousePointer2Icon, placement: 'header', onSelect: api.onShowFile }] : [] }}>
      <FileViewer key={path} path={path} locator={{ resource: { providerId: 'workspace', path }, view: { kind: 'published' } }} options={options} onClose={api.onClose} onBack={api.onBack} backLabel={`${taskId} /`} />
    </ViewerWindowProvider>
  </div>;
}

/** C7 at 390px: the French request card and « Mes demandes » (the same card stacked), both from the shared board. */
function CompactView({ onAnswer }: { readonly onAnswer: (text: string) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { document.documentElement.classList.add('coach'); }, []);
  const card: TaskRecord = confirmed ? { ...confirmation, waiting_on_you: false, waiting_on: { who: 'the builder', type: 'builder' } } : confirmation;
  return <main className="flex min-h-dvh w-full max-w-[390px] flex-col gap-6 bg-card p-4 text-card-foreground">
    {/* C7's header, thread and PM reply are spec 2 (not this block); this space keeps the card at the C7 position for comparison. */}
    <p className="flex h-[351px] items-center justify-center text-[13px] text-muted-foreground">C7 thread (spec 2)</p>
    <div role="list" data-compact-card=""><TaskRequestCard task={card} variant="compact" locale="fr" viewerAction="confirmation" actions={<>
      <Button variant="outline" onClick={() => onAnswer('Fictional request: modifier')}>Modifier</Button><Button onClick={() => { setConfirmed(true); onAnswer('Fictional request: confirmer'); }}>Confirmer</Button></>} /></div>
    <section className="flex flex-col gap-3" aria-label="Mes demandes"><h2 className="text-sm font-semibold">Mes demandes</h2>
      <TaskBoard tasks={[confirmation, ...tasks]} filter="mine" currentUser="alice" limit={2} locale="fr" viewerAction="confirmation" onOpen={task => onAnswer(`Open ${task.id}`)} /></section>
  </main>;
}

function Page() {
  const [narrow, setNarrow] = useState(false);
  const [answer, setAnswer] = useState('');
  const [request, setRequest] = useState<HostRequest>();
  const [filter, setFilter] = useState<TaskFilter>('mine');
  const [ambient, setAmbient] = useState(params.get('layout') === 'ambient');
  const [answers, setAnswers] = useState<Record<string, { answer: string; answeredBy: string; answeredAt: string }>>({});
  useEffect(() => { let active = true; const refresh = () => authorized(new Request(new URL('/api/answers', location.href))).then(response => response.json()).then(value => { if (active) setAnswers(current => JSON.stringify(current) === JSON.stringify(value) ? current : value); }); void refresh(); const timer = setInterval(() => { void refresh(); }, 500); return () => { active = false; clearInterval(timer); }; }, []);
  const projected = useMemo(() => tasks.map(task => task.id === 'D-201' ? { ...task, questions: task.questions?.map(question => ({ ...question, ...answers[question.id] })) } : task), [answers]);
  const selected = useSyncExternalStore(subscribe, selection, () => null);
  const chat = useRemoteChat({ conversationId: boot.conversationId, endpoint, fetch: authorized, identity: boot.identity });
  const mentions = useMemo(() => taskMentions({ tasks: projected, onOpen: task => { setFilter('all'); select(task.id); } }), [projected]);
  const mount = (next: HostRequest) => { setRequest({ ...next, mounted: true }); if (next.artifact.type === 'task') { const subject = next.artifact.subject; if ('task' in subject) { if (tasks.find(task => task.id === subject.task)?.requesterId !== 'alice') setFilter('all'); select(subject.task); } else { setFilter(subject.tasks.filter); select(null); } } };
  const open = (artifact: PresentedArtifact, reports?: ArtifactHostViewApi) => { const next = { artifact, reports, mounted: false }; if (params.has('deferMount')) setRequest(next); else mount(next); };
  const post = (task: string, question: string, value: string) => authorized(new Request(new URL('/api/answers', location.href), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, question, value }) }));
  // Discuss and Ask stage text in the ONE composer; nothing is sent until the person presses Send.
  const stage = (path: string, text: string) => {
    if (chat.status !== 'ready') return;
    const draft = chat.controller.getSnapshot().draft.text;
    chat.controller.setText(appendToDraft(draft, `${hasMention(draft, path) ? '' : `${mentionToken(path)} `}${text}`));
    document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus();
  };
  if (params.get('view') === 'compact') return <CompactView onAnswer={setAnswer} />;
  const chatView = (embedded: boolean) => chat.status === 'ready' ? <AmbientChat controller={chat.controller} actions={chat.actions} {...(embedded ? { state: 'expanded' as const } : { defaultState: 'bar' as const })} embedded={embedded} variant="surface" mentions={mentions} notifications={false} artifactTarget="host" artifacts={{ autoOpenTasks: true, open }} labels={{ title: 'PM' }} className={embedded ? 'h-full' : undefined} {...(embedded ? {} : { onDock: () => setAmbient(false) })} /> : <p role="status">Connecting PM…</p>;
  const appName = (size: string) => <span className={`font-serif ${size} font-semibold`}>Coach Max</span>;
  const showApp = <Button variant="outline" size="icon" aria-label="Show the app" title="Show the app" onClick={() => setAnswer('Fixture: the app panel is Studio-owned')}><SmartphoneIcon aria-hidden="true" /></Button>;
  return <main className="flex min-h-dvh min-w-0 flex-col bg-background text-foreground lg:h-dvh lg:flex-row lg:overflow-hidden">
    {/* Fixture stand-in for Studio's rail (not part of the task board). Its buttons drive the fixture. */}
    <nav aria-label="Fixture" className="flex shrink-0 items-center gap-2 bg-[var(--shell)] p-2 lg:w-12 lg:flex-col">
      <span aria-hidden="true" className="grid size-[26px] place-items-center rounded-full ring-[3px] ring-foreground ring-inset"><span className="size-2.5 rounded-full bg-[var(--studio-accent)]" /></span>
      <Button variant="ghost" size="icon" aria-label="Light / dark" onClick={() => document.documentElement.classList.toggle('dark')}><MoonIcon aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" aria-label={narrow ? 'Wide panel' : 'Narrow panel'} data-panel-width onClick={() => setNarrow(value => !value)}><ColumnsIcon aria-hidden="true" /></Button>
      {request && !request.mounted && <Button size="icon" data-mount-task aria-label="Mount requested task" onClick={() => mount(request)}><ListChecksIcon aria-hidden="true" /></Button>}
      <output aria-live="polite" className="sr-only">{answer}</output>
    </nav>
    {!ambient && <aside aria-label="PM conversation" className="flex min-w-0 shrink-0 flex-col bg-[var(--shell)] lg:w-[420px] lg:border-r lg:border-border">
      <header className="flex h-13 shrink-0 items-center gap-2 pr-1.5 pl-4">
        {appName('text-lg')}<Badge variant="secondary">Live</Badge><span className="flex-1" />
        {showApp}
        <Button variant="ghost" size="icon" aria-label="Collapse the conversation to the ambient bar" title="Collapse the conversation to the ambient bar" onClick={() => setAmbient(true)}><MinusIcon aria-hidden="true" /></Button>
      </header>
      <div className="h-[480px] min-h-0 lg:h-auto lg:flex-1" data-feedback-ignore="">{chatView(true)}</div>
    </aside>}
    <section aria-label="Right stage" className={`flex min-h-dvh min-w-0 flex-1 flex-col lg:min-h-0 ${narrow ? 'max-w-md' : ''}`}>
      <TaskBoard className="min-h-dvh flex-1 lg:min-h-0" tasks={projected} overlayClassName="shadow-[var(--task-overlay-shadow)]" filter={filter} onFilterChange={setFilter} currentUser="alice" selectedTask={selected} onSelectedTaskChange={select}
        barStart={ambient ? <span className="mr-2 flex items-center gap-2 text-foreground">{appName('text-[17px]')}{showApp}</span> : undefined}
        actions={task => <MountReport request={request} selected={selected} mountedTask={task.id} />}
        onAnswer={(task, question, value) => { setAnswer(`Fictional choice: ${task.id} · ${question.id} · ${value}`); void post(task.id, question.id, value); }}
        onOther={(task, question, text) => { setAnswer(`Fictional free answer: ${task.id} · ${question.id} · ${text}`); void post(task.id, question.id, text); }}
        onDiscussQuestion={(task, question) => stage(`task:${task.id}`, question.text)}
        onAsk={task => stage(`task:${task.id}`, '')}
        onShowFile={(task, file) => setAnswer(`Host Montrer target: ${task.id} · ${file.path}. PM pointing is supplied by the host, not this fixture.`)}
        renderFile={(task, file, api) => <TaskFile key={file.path} taskId={task.id} path={file.path} api={api} />} />
      <MountReport request={request} selected={selected} />
    </section>
    {ambient && chatView(false)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Page />);
