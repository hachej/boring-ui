import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { MousePointer2Icon } from 'lucide-react';
import { createResourceClient } from '@hachej/boring-files/remote';
import type { ResourceIdentity } from '@hachej/boring-files/remote';
import { mentionToken } from '@hachej/boring-ui-kit/chat-text';
import { taskMentions } from '../../registry/task-mentions/task-mentions';
import { taskFromUrl, taskUrl } from '@hachej/boring-ui-kit/task-board';
import type { TaskFilter } from '@hachej/boring-ui-kit/task-board';
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
import { tasks } from './tasks';

declare global { interface Window { __TASK_BOARD__: { token: string; conversationId: string; identity: ResourceIdentity & { readonly runtimeId: string } } } }
const boot = window.__TASK_BOARD__;
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${boot.token}`); return fetch(new Request(request, { headers })); };
const endpoint = () => new URL('/api/chat', location.href);
const subscribe = (changed: () => void) => { window.addEventListener('popstate', changed); window.addEventListener('boring:task-navigation', changed); return () => { window.removeEventListener('popstate', changed); window.removeEventListener('boring:task-navigation', changed); }; };
const selection = () => taskFromUrl(location.href);
const select = (id: string | null) => { history.pushState(null, '', taskUrl(location.href, id)); window.dispatchEvent(new Event('boring:task-navigation')); };
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

function TaskFile({ taskId, path, api }: { readonly taskId: string; readonly path: string; readonly api: TaskFileViewApi }) {
  const [fullscreen, setFullscreen] = useState(false);
  const options = useMemo(() => ({ client: createResourceClient({ endpoint: new URL('/api/resources', location.href), identity: boot.identity, fetch: authorized }), identity: boot.identity, kinds: [markdownKind, htmlKind, imageKind] }), []);
  return <div data-host-file={path} data-fullscreen={fullscreen} className={fullscreen ? 'fixed inset-0 z-40 bg-background' : 'h-full min-h-0'}>
    <ViewerWindowProvider value={{ fullscreen, onFullscreenChange: setFullscreen, actions: api.onShowFile ? [{ id: 'show-file', label: 'Montrer', icon: MousePointer2Icon, placement: 'header', onSelect: api.onShowFile }] : [] }}>
      <FileViewer key={path} path={path} locator={{ resource: { providerId: 'workspace', path }, view: { kind: 'published' } }} options={options} onClose={api.onClose} onBack={api.onBack} backLabel={`${taskId} /`} />
    </ViewerWindowProvider>
  </div>;
}

function Page() {
  const [narrow, setNarrow] = useState(false);
  const [answer, setAnswer] = useState('');
  const [request, setRequest] = useState<HostRequest>();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [answers, setAnswers] = useState<Record<string, { answer: string; answeredBy: string }>>({});
  useEffect(() => { let active = true; const refresh = () => authorized(new Request(new URL('/api/answers', location.href))).then(response => response.json()).then(value => { if (active) setAnswers(current => JSON.stringify(current) === JSON.stringify(value) ? current : value); }); void refresh(); const timer = setInterval(() => { void refresh(); }, 500); return () => { active = false; clearInterval(timer); }; }, []);
  const projected = useMemo(() => tasks.map(task => task.id === 'D-201' ? { ...task, questions: task.questions?.map(question => ({ ...question, ...answers[question.id] })) } : task), [answers]);
  const selected = useSyncExternalStore(subscribe, selection, () => null);
  const chat = useRemoteChat({ conversationId: boot.conversationId, endpoint, fetch: authorized, identity: boot.identity });
  const mentions = useMemo(() => taskMentions({ tasks: projected, onOpen: task => { setFilter('all'); select(task.id); } }), [projected]);
  const mount = (next: HostRequest) => { setRequest({ ...next, mounted: true }); if (next.artifact.type === 'task') { const subject = next.artifact.subject; if ('task' in subject) { setFilter('all'); select(subject.task); } else { setFilter(subject.tasks.filter); select(null); } } };
  const open = (artifact: PresentedArtifact, reports?: ArtifactHostViewApi) => { const next = { artifact, reports, mounted: false }; if (new URL(location.href).searchParams.has('deferMount')) setRequest(next); else mount(next); };
  return <main className="flex min-h-dvh min-w-0 flex-col gap-6 p-4">
    <div className="flex flex-wrap items-center gap-2"><h1>Village outings · fictional host</h1>
      <Button variant="outline" onClick={() => document.documentElement.classList.toggle('dark')}>Light / dark</Button>
      <Button variant="outline" onClick={() => setNarrow(value => !value)} data-panel-width>{narrow ? 'Wide panel' : 'Narrow panel'}</Button>
      {request && !request.mounted && <Button data-mount-task onClick={() => mount(request)}>Mount requested task</Button>}
    </div>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-6" aria-label="PM conversation">
        <div className="h-[480px] min-h-0" data-feedback-ignore="">
          {chat.status === 'ready' ? <AmbientChat controller={chat.controller} actions={chat.actions} state="expanded" embedded variant="surface" mentions={mentions} notifications={false} artifactTarget="host" artifacts={{ autoOpenTasks: true, open }} labels={{ title: 'Village PM' }} className="h-full" /> : <p role="status">Connecting PM…</p>}
        </div>
        <section className="flex flex-col gap-3"><h2>Vos dernières demandes</h2><TaskBoard tasks={tasks} filter="mine" currentUser="alice" limit={2} variant="compact" onOpen={task => { setFilter('all'); select(task.id); }} /></section>
        <section className="flex flex-col gap-3"><h2>À confirmer</h2><div role="list"><TaskRequestCard task={tasks[2]!} actions={<><Button variant="outline" onClick={() => setAnswer('Fictional request: modify')}>Modifier</Button><Button onClick={() => setAnswer('Fictional request: confirm')}>Confirmer</Button></>} /></div></section>
        <p>One native PM conversation. Try “Show D-201”, “Show waiting on me” or “Show my requests”.</p>
        <output aria-live="polite">{answer}</output>
      </aside>
      <section aria-label="Right stage" className={narrow ? 'min-h-dvh min-w-0 max-w-md lg:min-h-0' : 'min-h-dvh min-w-0 lg:min-h-0'}>
        <TaskBoard tasks={projected} overlayClassName="shadow-xl" actions={task => <MountReport request={request} selected={selected} mountedTask={task.id} />} filter={filter} currentUser="alice" selectedTask={selected} onSelectedTaskChange={select}
          onAnswer={(task, question, value) => { setAnswer(`Fictional choice: ${task.id} · ${question.id} · ${value}`); void authorized(new Request(new URL('/api/answers', location.href), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: task.id, question: question.id, value }) })); }}
          onOther={(task, question) => setAnswer(`Host free-answer intent: ${task.id} · ${question.id}`)}
          onDiscussQuestion={(task, question) => { if (chat.status !== 'ready') return; chat.controller.setText(`${mentionToken(`task:${task.id}`)} Discuss route question: ${question.text}`); void chat.controller.send('followUp'); }}
          onShowFile={(task, file) => setAnswer(`Host Montrer target: ${task.id} · ${file.path}. PM pointing is supplied by the host, not this fixture.`)}
          renderFile={(task, file, api) => <TaskFile key={file.path} taskId={task.id} path={file.path} api={api} />} />
        <MountReport request={request} selected={selected} />
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Page />);
