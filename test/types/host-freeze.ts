// The frozen "Shared contract" (host-contract-freeze AC-12): every public name is used, and each refusal sits beside a twin that
// compiles and differs from it in one thing only. Removing one expect-error line fails this file on that line.
import { defineExtension, type Extension, type Harness, type HarnessOptions, type Storage, type ToolRegistration } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai';
import * as EffectContext from 'effect/Context';
import { defineAgent, type SkillSource } from '@hachej/boring-agent/agents';
import type { MeteringSink } from '@hachej/boring-agent/metering';
import type {
  AgentKit, AppDefinition, AppHostProps, Assets, HostBuild, HostEntry, MountApp, MountOptions, OpenHarness, Person, ResolveLanguage,
  RouteName, SecretByName, ViewProps, WriteAttribution,
} from '@hachej/boring-agent/host';
import { SenderUnknown } from '@hachej/boring-agent/host-runtime';
import type {
  Acting, Actor, AppTools, BlobStore, CheckAgentTools, CheckExpose, CreateHostFiles, CreateSession, HostFiles, HostSession, ModelRoute,
} from '@hachej/boring-agent/host-runtime';
import * as runtime from '@hachej/boring-agent/host-runtime';
import * as cloudflare from '@hachej/boring-agent/host-cloudflare';
import * as build from '@hachej/boring-agent/host-build';
import fr from '../../fixtures/host-apps/notes/words.ts';

declare const def: AppDefinition;
declare const storage: Storage;
declare const context: Context;
declare const harness: Harness;
declare const models: Models;
declare const kit: AgentKit;
declare const sink: MeteringSink;
declare const person: Person;
declare const session: HostSession;

export const stubs = [runtime.createSession satisfies CreateSession, runtime.appTools satisfies AppTools, runtime.checkExpose satisfies CheckExpose,
  runtime.checkAgentTools satisfies CheckAgentTools, runtime.modelRoute satisfies ModelRoute, cloudflare.mountApp satisfies MountApp,
  cloudflare.entry satisfies HostEntry, build.hostBuild satisfies HostBuild];
export const otherNames = (a: HostFiles, b: BlobStore, c: CreateHostFiles, d: SecretByName, e: ResolveLanguage, f: Assets, g: RouteName, h: WriteAttribution, i: Actor) => [a, b, c, d, e, f, g, h, i, new SenderUnknown('call')];
export const sessionPerson = (): Promise<Response> => session.fetch(new Request('https://example.test'), person);

export const openHarness: OpenHarness = (store: Storage, options: HarnessOptions, ctx: Context) => Promise.resolve(harness);
export const openedOnce = openHarness(storage, {} as HarnessOptions, context);

const sessionOptions = {
  id: 'me:camille', def, api: {}, storage, openHarness, models, model: { provider: 'faux', modelId: 'faux' },
  services: () => EffectContext.empty() as EffectContext.Context<any>, skills: () => ({}) as SkillSource, kv: { get: async () => undefined, put: async () => undefined },
  wake: { arm: async () => undefined }, language: async () => 'fr' as const, budget: sink,
};
declare const createSession: CreateSession;
export const withId = createSession(sessionOptions);
const { id: _id, ...withoutId } = sessionOptions;
// @ts-expect-error A session needs its id.
export const noId = createSession(withoutId);

export const withExtensions = defineAgent({ id: 'a', model: kit.model, extensions: [kit.tools('assistant')] });
// @ts-expect-error `tools` takes a list of tools; `kit.tools(...)` is an Extension, which goes in `extensions`.
export const withTools = defineAgent({ id: 'a', model: kit.model, tools: kit.tools('assistant') });

export const extensionTools: AppTools = () => defineExtension({ name: 'host.tools.a' });
// @ts-expect-error An AppTools builds one Extension, not a list of registrations.
export const listTools: AppTools = () => [] as ToolRegistration[];

const options = { main: 'file:///entry.js', openHarness, worker: { name: 'w' } } satisfies MountOptions;
export const fullOptions: MountOptions = { ...options, signUp: true, testRoutes: false, modelRoutes: ['openrouter'], secrets: { store: 's', prefix: 'p' } };
// @ts-expect-error The stage is the stack's, not an option of the mount.
export const withStage: MountOptions = { ...options, stage: 'dev' };

export const actingRecord: Acting = async () => ({ requestedBy: 'camille' });
// @ts-expect-error An Acting resolves to an Actor, never a bare string.
export const actingString: Acting = async () => 'camille';

export const actingWithContext: Acting = async (call, ctx) => call.memo<Actor>('acting', { requestedBy: 'camille' }, ctx);
// @ts-expect-error With one parameter the record lands in the `Context` slot (TS2353: `requestedBy` is not in `Context`).
export const actingWithoutContext: Acting = async (call) => call.memo<Actor>('acting', { requestedBy: 'camille' });

type Notes = typeof fr;
export const typedHost: AppHostProps<typeof fr> = { name: 'notes', languages: { base: 'fr', words: { fr } }, views: [{ id: 'notes', component: (props: ViewProps<Notes>) => props.words.notes.empty && null }] };
export const bareHost: AppHostProps = { name: 'notes', languages: { base: 'fr', words: { fr } }, views: [{ id: 'notes', component: (props: ViewProps) => props.language && null }] };
export const bareHostTypedView: AppHostProps = {
  name: 'notes', languages: { base: 'fr', words: { fr } },
  // @ts-expect-error A view typed with the app's own words needs `AppHostProps<typeof fr>`, not the bare form.
  views: [{ id: 'notes', component: (props: ViewProps<Notes>) => props.words.notes.empty && null }],
};

export const noExtensionSoFar: Extension | undefined = undefined;
export const mountOnly = (a: MountApp, b: HostBuild) => [a, b];
