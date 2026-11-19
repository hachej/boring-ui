import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentChat } from '../../registry/agent-chat/agent-chat.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import atlas from '../atlas/composer-atlas.json';
import { controlled } from '../atlas/connection.mjs';
import { runSteps } from '../atlas/steps.mjs';
import script from '../scenarios/scripts/design-system.json';
import { AGENTS, TASKS, Task } from './agent-card-demo.jsx';
import { createDemoController } from './demo-controller.mjs';
import { Diagram } from './composer-atlas-diagram.jsx';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';

// Component scenario `component:composer-atlas`: the Atlas of the one composer. Every state (what the person sees, its test id, a live thumbnail of the real component) and every transition
// (from, to, the trigger, the guard) read from ux/atlas/composer-atlas.json, the one source this page and test/contracts/composer-atlas.test.mjs share: the test drives each listed
// state and transition through the real controls, so the page cannot say what the code does not do. The shell's states are thumbnails of the design-system page (`?atlas=<state>` runs
// the state's own steps on its real controls); the agent card and the chat render here, from the kit's own parts over a scripted agent. Kit parts and tokens only.
// Query: `dark=1`.
const params = new URLSearchParams(location.search);
const stored = (() => { try { return localStorage.getItem('ux-theme'); } catch { return null; } })();
const dark = params.get('dark') === '1' || stored === 'dark';
document.documentElement.classList.toggle('dark', dark);

const states = atlas.states;
const byId = new Map(states.map(state => [state.id, state]));
const groups = [...new Set(states.map(state => state.group))];
const numbered = atlas.transitions.map((transition, index) => ({ ...transition, number: index + 1 }));
const KINDS = { click: 'Click', tap: 'Tap', key: 'Key', drag: 'Drag', event: 'Event', resize: 'Resize' };
const testId = state => state.detect.has.join(' + ');

// The shell's thumbnails are the design-system page: beside this page in the site (`<name>/demo.html`) or in the capture folder (`_pages/<name>.html`).
const frameBase = location.pathname.endsWith('/demo.html') ? '../component-design-system/demo.html' : 'component-design-system.html';
const frameUrl = (state, isDark) => {
  const scene = atlas.scenes[state.scene];
  return `${frameBase}?${[`atlas=${state.thumb ?? state.id}`, scene.props.composer === 'explore' ? 'composer=explore' : '', isDark ? 'dark=1' : ''].filter(Boolean).join('&')}`;
};

/** The page's dark switch (the site's top bar sets the `dark` class of this document): the thumbnails follow it. */
function useDark() {
  const [isDark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const watch = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, []);
  return isDark;
}

/** A live thumbnail of a shell state: the design-system page in a frame at the scene's viewport, scaled to the card, loaded when it scrolls into view. */
function ShellThumb({ state, isDark }) {
  const scene = atlas.scenes[state.scene];
  const [vw, vh] = scene.viewport;
  const box = useRef(null), frame = useRef(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const element = box.current;
    const fit = () => setScale(element.clientWidth / vw);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(element);
    return () => watch.disconnect();
  }, [vw]);
  // The frame was loaded with the theme of that moment; a switch later reaches it here.
  useEffect(() => { try { frame.current?.contentDocument?.documentElement.classList.toggle('dark', isDark); } catch { /* not loaded yet */ } }, [isDark]);
  return <div className={vw < vh ? 'max-w-40' : ''}>
    <div ref={box} data-testid={`atlas-thumb-${state.id}`} style={{ aspectRatio: `${vw} / ${vh}` }} className="relative w-full overflow-hidden rounded-(--radius-lg) bg-muted ring-1 ring-border">
      <iframe ref={frame} loading="lazy" title={`${state.name}, live`} src={frameUrl(state, isDark)} tabIndex={-1} style={{ width: vw, height: vh, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="pointer-events-none absolute top-0 left-0 border-0 bg-background" />
    </div>
  </div>;
}

/** The agent card at a state: the kit's AgentCard over a scripted agent, taken there by the state's own steps on its real controls. */
function CardThumb({ state }) {
  const box = useRef(null);
  const [level, setLevel] = useState(0), [docked, setDocked] = useState(false), [dock, setDock] = useState(null);
  const task = TASKS.find(item => item.id === 'done');
  useEffect(() => {
    if (!dock) return;
    void runSteps({ root: box.current, win: window, act: run => run(), hooks: {} }, state.reach);
  }, [dock, state]);
  return <div ref={box} data-testid={`atlas-thumb-${state.id}`} className="flex flex-col gap-2">
    <Task task={task} level={level} onLevel={setLevel} dock={dock} docked={docked} onDocked={setDocked} />
    <div ref={setDock} className={docked ? 'h-48 overflow-hidden rounded-(--radius-lg) bg-card ring-1 ring-border' : 'hidden'} />
  </div>;
}

/** The chat at a state (empty, loading, failed, with a message): the kit's AgentChat over a scripted agent whose connection the page sets. */
function ChatThumb({ state }) {
  const scene = atlas.scenes[state.scene];
  const demo = useMemo(() => createDemoController({ script, pace: 1 }), []);
  const chat = useMemo(() => controlled(demo, scene.connection), [demo, scene]);
  const box = useRef(null);
  useEffect(() => {
    void runSteps({ root: box.current, win: window, act: run => run(), hooks: { say: text => { void demo.controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } }); }, connection: kind => chat.set(kind) } }, state.reach);
  }, [demo, chat, state]);
  return <div ref={box} data-testid={`atlas-thumb-${state.id}`} className="h-72 overflow-hidden rounded-(--radius-lg) ring-1 ring-border">
    <AgentChat controller={chat.controller} agent={AGENTS.reader} title="Read the supplier invoices" chatProps={{ actions: demo.actions, locale: 'en' }} />
  </div>;
}

function Thumb({ state, isDark }) {
  const scene = atlas.scenes[state.scene];
  return scene.kind === 'card' ? <CardThumb state={state} /> : scene.kind === 'chat' ? <ChatThumb state={state} /> : <ShellThumb state={state} isDark={isDark} />;
}

function StateCard({ state, isDark }) {
  const entering = numbered.filter(transition => transition.to === state.id && transition.from !== state.id).map(transition => transition.number);
  return <Card data-testid={`atlas-state-${state.id}`} id={`state-${state.id}`} size="sm" className="min-w-0">
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2">{state.name}<Badge variant="outline" data-testid="atlas-state-id">{state.id}</Badge></CardTitle>
      <CardDescription>{state.sees}</CardDescription>
    </CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-3">
      <Thumb state={state} isDark={isDark} />
      <dl className="m-0 flex min-w-0 flex-col gap-1 text-xs">
        <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Test id</dt><dd className="m-0 min-w-0 wrap-anywhere"><code data-testid="atlas-test-id">{testId(state)}</code></dd></div>
        <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Code</dt><dd className="m-0 min-w-0 wrap-anywhere"><code>{state.code}</code></dd></div>
        {entering.length > 0 && <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Entered by</dt><dd className="m-0">{entering.map(number => `#${number}`).join(', ')}</dd></div>}
      </dl>
    </CardContent>
  </Card>;
}

function Transitions() {
  const [query, setQuery] = useState('');
  const shown = numbered.filter(transition => {
    const text = [transition.from, transition.to, transition.trigger.kind, transition.trigger.label, transition.guard, byId.get(transition.from).name, byId.get(transition.to).name].join(' ').toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  return <div className="flex min-w-0 flex-col gap-3">
    <Input data-testid="atlas-filter" aria-label="Filter the transitions" placeholder="Filter: a state, a key, a button, a width" value={query} onChange={event => setQuery(event.target.value)} className="max-w-md" />
    <div data-testid="atlas-transition-table" className="hidden rounded-(--radius-lg) ring-1 ring-border md:block">
      <Table>
        <TableHeader><TableRow><TableHead>#</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Trigger</TableHead><TableHead>Guard</TableHead></TableRow></TableHeader>
        <TableBody>
          {shown.map(transition => <TableRow key={transition.id} data-testid={`atlas-transition-${transition.id}`}>
            <TableCell className="tabular-nums">{transition.number}</TableCell>
            <TableCell><a href={`#state-${transition.from}`} className="text-link underline underline-offset-4">{byId.get(transition.from).name}</a></TableCell>
            <TableCell><a href={`#state-${transition.to}`} className="text-link underline underline-offset-4">{byId.get(transition.to).name}</a></TableCell>
            <TableCell className="whitespace-normal"><Badge variant="secondary">{KINDS[transition.trigger.kind]}</Badge>{' '}{transition.trigger.label}
              {transition.trigger.alt && <span className="text-muted-foreground"> (also {transition.trigger.alt.map(way => way.map(step => step.key ?? step.click).join(' ')).join(', ')})</span>}
              {transition.refused && <Badge variant="outline">Refused</Badge>}
              {transition.note && <span className="block text-xs text-muted-foreground">{transition.note}</span>}</TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">{transition.guard}</TableCell>
          </TableRow>)}
          {shown.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No transition matches.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
    <ItemGroup data-testid="atlas-transition-list" className="gap-2 md:hidden">
      {shown.map(transition => <Item key={transition.id} variant="outline" data-testid={`atlas-transition-item-${transition.id}`}>
        <ItemContent>
          <ItemTitle className="flex-wrap">#{transition.number} {byId.get(transition.from).name} to {byId.get(transition.to).name}</ItemTitle>
          <ItemDescription className="line-clamp-none"><Badge variant="secondary">{KINDS[transition.trigger.kind]}</Badge>{' '}{transition.trigger.label}{transition.refused ? ' (refused)' : ''}</ItemDescription>
          <ItemDescription className="line-clamp-none">Guard: {transition.guard}</ItemDescription>
        </ItemContent>
      </Item>)}
    </ItemGroup>
  </div>;
}

const slugOf = group => group.toLowerCase().replace(/\W+/g, '-');
function App() {
  const isDark = useDark();
  return <main data-testid="atlas" className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-8 bg-background p-4 text-foreground sm:p-8">
    <header className="flex flex-col gap-3">
      <h1 className="m-0 text-2xl font-semibold">{atlas.title}</h1>
      <p className="m-0 max-w-3xl text-muted-foreground">{atlas.summary} It is one composer: the same field, the same strip, the same chat at every level. Each state below names the test id that marks it; each transition names its trigger and its guard.
        A test drives every one of them through the real controls, so this page cannot drift from the code.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge data-testid="atlas-count-states" variant="secondary">{states.length} states</Badge>
        <Badge data-testid="atlas-count-transitions" variant="secondary">{atlas.transitions.length} transitions</Badge>
        <Button variant="outline" size="sm" render={<a href="#states" />}>States</Button>
        <Button variant="outline" size="sm" render={<a href="#transitions" />}>Transitions</Button>
        <Button variant="outline" size="sm" render={<a href="#diagrams" />}>Diagrams</Button>
      </div>
      <p className="m-0 text-xs text-muted-foreground">Keys: <Kbd>Ctrl</Kbd> + <Kbd>J</Kbd> (or <Kbd>Cmd</Kbd> + <Kbd>J</Kbd>) opens and closes the explore panel; <Kbd>Esc</Kbd> steps back one level; the arrow keys move the floating bar.</p>
    </header>
    <section id="states" data-testid="atlas-states" className="flex flex-col gap-6">
      <h2 className="m-0 text-xl font-semibold">States</h2>
      {groups.map(group => <div key={group} id={`group-${slugOf(group)}`} className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-semibold">{group}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {states.filter(state => state.group === group).map(state => <StateCard key={state.id} state={state} isDark={isDark} />)}
        </div>
      </div>)}
    </section>
    <section id="transitions" data-testid="atlas-transitions" className="flex flex-col gap-3">
      <h2 className="m-0 text-xl font-semibold">Transitions</h2>
      <p className="m-0 text-muted-foreground">From a state, by a trigger, to a state, while the guard holds. The numbers are those of the diagrams.</p>
      <Transitions />
    </section>
    <section id="diagrams" data-testid="atlas-diagrams" className="flex flex-col gap-4">
      <h2 className="m-0 text-xl font-semibold">Diagrams</h2>
      <p className="m-0 text-muted-foreground">One diagram per group. A dashed box is a state of another group that this one leads to or comes from.</p>
      {groups.map(group => <div key={group} className="flex flex-col gap-2"><h3 className="m-0 text-base font-semibold">{group}</h3><Diagram group={group} /></div>)}
    </section>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
