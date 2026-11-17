// The neutral session: one conversation for one id, `me:<person>` or `reader:<unit>`. Opening, waking, alarms, watching and recovery are
// pi-durable's; the host hands in the Harness factory (BORING-PI-2) and the ports. This file joins them: nothing here is a second lifecycle.
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createRegistry, defineExtension } from '@earendil-works/pi-durable';
import type { Harness, Wake } from '@earendil-works/pi-durable';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { answerUserQuestion, createAskUserTool } from '../../ask-user.js';
import { createChatTransportHandler } from '../../chat-transport.js';
import { ownBindingKey } from '../../durable-wait.js';
import { createMeter } from '../../metering.js';
import type { AgentKit } from '../define-app.js';
import { checkAgents } from '../define-app.js';
import type { Scope } from '../index.js';
import type { Acting, Actor, CreateSession } from './contract.js';
import { appTools } from './tools.js';

/** pi-durable's own advice: while work runs, an alarm a minute away recovers a lost instance. */
const HEARTBEAT_MS = 60_000;
/** An alarm call waits for the run it woke, at most this long. */
const ALARM_WAIT_MS = 300_000;

const answer = (status: number, error: string) => Response.json({ error }, { status });

export const createSession: CreateSession = options => {
  const { id, def, api, openHarness } = options;
  const kind = id.startsWith('me:') ? 'me' : id.startsWith('reader:') ? 'reader' : undefined;
  const owner = id.slice(id.indexOf(':') + 1);
  if (!kind || !owner) throw new Error(`createSession(${id}): a session id is me:<person> or reader:<unit>; a shared session comes with host-session-access`);
  const readers = [...new Set((def.wakes ?? []).map(w => w.agent))];
  if (readers.length > 1) throw new Error(`createSession(${id}): ${def.name} has wakes for more than one agent (${readers.join(', ')}); one reader per app until a later card designs several`);
  const readerAgent = readers[0];
  if (kind === 'reader' && !readerAgent) throw new Error(`createSession(${id}): ${def.name} has no wakes, so it has no reader`);
  // A wake's `event` is Domain's stable id of its policy (`policy.key`), never a JavaScript name, which a bundler erases.
  const declared = (def.wakes ?? []).map(w => (w.policy as { key?: unknown }).key);
  if (declared.some(key => typeof key !== 'string' || key === '')) throw new Error(`createSession(${id}): ${def.name}: a wake policy has no stable key (policy.key)`);
  let ignoredWake: string | undefined;
  const scope: Scope | undefined = kind === 'reader' ? { kind: 'reader', unit: owner, role: 'editor', ops: [...(def.expose[readerAgent!] ?? [])] } : undefined;
  const hostFiles = kind === 'me' && def.needs?.includes('files') === true ? options.files : undefined; // files only where the app asks, and only for one person
  const tools = options.tools ?? appTools;
  const requestedBy = kind === 'me' ? owner : id;

  // Who is acting for one call: the session's own record, written at the call's first run and read back after a restart.
  const attribution: Acting = async (call, context) => {
    const name = `requestedBy:${await call.commit(tx => ownBindingKey(tx, call), context)}`;
    return call.memo<Actor>(name, { requestedBy }, context);
  };

  const arm = (wake: Wake) => options.wake.arm(wake.active ? Math.min(Date.now() + HEARTBEAT_MS, wake.at ?? Infinity) : wake.at);
  let idle: Array<() => void> = [];
  const onWake = (wake: Wake) => {
    void arm(wake).catch(() => undefined); // offered again at the next change; the fallback alarm armed before opening still stands
    if (!wake.active) idle.splice(0).forEach(done => done());
  };
  const untilIdle = (harness: Harness) => new Promise<void>(resolve => {
    if (!harness.wake().active) { resolve(); return; }
    const timer = setTimeout(() => finish(), ALARM_WAIT_MS);
    const finish = () => { clearTimeout(timer); resolve(); };
    idle.push(finish);
    void harness.closed.then(finish); // a Harness the host closed under this wait leaves no timer behind

  });

  const kitOf = (toolsOf: AgentKit['tools']): AgentKit => ({
    person: owner, model: options.model, skills: options.skills, ask: createAskUserTool(), tools: toolsOf,
    files: hostFiles ? [createReadTool(), createWriteTool(), createEditTool()] as AgentKit['files'] : [],
  });
  // The agent this session talks to must exist: said now, not as a failed open on the first request.
  const talksTo = kind === 'me' ? 'assistant' : readerAgent!;
  if (!Object.hasOwn(def.agents?.(kitOf(agent => defineExtension({ name: `host.tools.${agent}` }))) ?? {}, talksTo)) {
    throw new Error(kind === 'me' ? `createSession(${id}): ${def.name} declares no agent a person can talk to: no agent named ${talksTo}`
      : `createSession(${id}): ${def.name} declares no reader agent: no agent named ${talksTo}`);
  }
  let openError: string | undefined;

  const build = async () => {
    await options.wake.arm(Date.now() + HEARTBEAT_MS); // before anything can throw: an object whose open fails is started again
    const agents = def.agents!(kitOf(agent => tools({ def, api, agent, scope, services: options.services, storage: options.unitStorage, attribution })));
    checkAgents(def, agents);
    const registry = createRegistry();
    for (const agent of Object.values(agents)) agent.install(registry);
    const person = { id: owner, language: def.languages.base };
    const harness = await openHarness(options.storage, {
      models: options.models, registry, onWake, settings: { extensions: [] },
      ...(hostFiles ? { env: async () => hostFiles.env(person) } : {}),
    }, ctx);
    try {
      await arm(harness.wake()); // armed before resume() runs anything
      harness.resume(); // work a lost instance left, and due sleeps
      const root = await harness.root(ctx, { agent: agents[kind === 'me' ? 'assistant' : readerAgent!]!.agent });
      const meter = createMeter({ sink: options.budget, context: ctx, models: typeof options.models === 'function' ? options.models() : options.models });
      if (options.budget.openRuns) await meter.recover(harness); // finish the runs a lost instance left open in the ledger
      return { harness, root, meter };
    } catch (error) { await harness.close(ctx).catch(() => undefined); throw error; }
  };
  // Opened on first use, once; a failed open is forgotten so the next request tries again.
  let opened: ReturnType<typeof build> | undefined;
  const open = () => (opened ??= build().then(
    session => { openError = undefined; return session; },
    error => { opened = undefined; openError = error instanceof Error ? error.message : String(error); throw error; }, // the cause stays on the host: `info()`
  ));
  const armActive = (harness: Harness) => arm({ ...harness.wake(), active: true });

  const fetch: ReturnType<CreateSession>['fetch'] = async (request, sender) => {
    if (kind !== 'me' || sender.id !== owner) return answer(404, 'unknown');
    let session: Awaited<ReturnType<typeof build>>;
    try { session = await open(); } catch { return answer(503, 'unavailable'); }
    const operation = new URL(request.url).searchParams.get('op');
    if (operation === 'submit' || operation === 'abort' || operation === 'answer') await armActive(session.harness); // before any call that can start work
    return createChatTransportHandler({
      authenticate: async () => {
        const language = operation === 'submit' ? (await options.language(sender.id)) ?? def.languages.base : undefined; // the app's record, never the request
        return {
          conversation: session.meter.conversation(session.root, { userId: sender.id }), context: ctx,
          answer: (questionId, text) => answerUserQuestion(session.root, questionId, text, ctx),
          prepareInput: async content => {
            const tag = `[language: ${language}]`;
            return typeof content === 'string' ? `${tag}\n${content}` : [{ type: 'text' as const, text: tag }, ...content];
          },
        };
      },
    })(request);
  };

  return {
    create: async () => answer(404, 'not-supported'),
    fetch,
    ...(hostFiles ? { upload: async (request, sender) => (sender.id === owner ? hostFiles.upload(request, sender) : answer(404, 'unknown')) } : {}),
    wake: async (unit, event, key, text) => {
      if (kind !== 'reader' || unit !== owner) return;
      if (!declared.includes(event)) { ignoredWake = event; return; } // `HostSession.wake` resolves void (frozen): the refusal is in `info()`
      const { harness, root, meter } = await open();
      await armActive(harness);
      await meter.conversation(root, { userId: id }).submit({ type: 'input', content: text, requestId: `${event}-${key}` }, ctx);
    },
    alarm: async () => {
      const { harness } = await open();
      await armActive(harness);
      harness.resume(); // due sleeps and work a lost instance left
      await untilIdle(harness);
    },
    info: async () => ({ id, scope, openError, ignoredWake, wake: await opened?.then(({ harness }) => harness.wake(), () => undefined) }),
  };
};
