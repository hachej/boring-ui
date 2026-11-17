// Items 3, 4, 6b, 7 and 11 of the README's "Shared contract". `SenderUnknown` is the one value.
import type { Extension, Storage, ToolExecutionApi } from '@earendil-works/pi-durable';
import type { ExecutionEnv, FileSystem } from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai';
import type { Toolable } from '@alchemy.run/domain/Ai';
import type * as EffectContext from 'effect/Context';
import type { DefinedAgent, SkillSource } from '../../agents.js';
import type { AppDefinition, CapabilityMethods, Role, Scope, UnitStorage } from '../index.js';
import type { OpenHarness, Person, ResolveLanguage, RouteName, SecretByName } from '../contract.js';
import type { MeteringSink } from '../../metering.js';

/** `AppDefinition.api` is `unknown` because `./host` may not import Domain's `Ai` module; the one cast to what Domain's `toToolkit` and `toMcp` take lives here. */
export const toolableApi = (def: AppDefinition): Toolable => def.api as Toolable;

/** Item 3. `upload` exists only for an app with needs: ["files"]; on a shared session it answers 403 `files-personal-only`. */
export type HostSession = {
  readonly create: (scope: { readonly unit: string; readonly role: Role }, creator: Person) => Promise<Response>;
  readonly fetch: (request: Request, person: Person) => Promise<Response>;
  readonly upload?: (request: Request, person: Person) => Promise<Response>;
  readonly wake: (unit: string, event: string, key: string, text: string) => Promise<void>;
  readonly alarm: () => Promise<void>;
  readonly info: () => Promise<unknown>;
};
export type CreateSession = (options: {
  readonly id: string;
  readonly def: AppDefinition;
  readonly api?: Toolable | undefined;
  readonly storage: Storage;
  readonly unitStorage?: ((unit: string) => UnitStorage) | undefined;
  readonly openHarness: OpenHarness;
  readonly models: Models | (() => Models);
  readonly model: { readonly provider: string; readonly modelId: string };
  readonly services?: (() => EffectContext.Context<any>) | undefined;
  readonly skills: (agent: string) => SkillSource;
  readonly tools?: AppTools;
  readonly kv: { readonly get: (key: string) => Promise<string | undefined>; readonly put: (key: string, value: string) => Promise<void> };
  readonly wake: { readonly arm: (at: number | undefined) => Promise<void> };
  readonly language: ResolveLanguage;
  readonly budget: MeteringSink;
  readonly files?: HostFiles;
}) => HostSession;

/** Item 4. */
export type BlobStore = {
  readonly put: (key: string, body: Uint8Array | ReadableStream<Uint8Array>) => Promise<void>;
  readonly get: (key: string, range?: { readonly offset: number; readonly length: number }) => Promise<Uint8Array | undefined>;
  readonly head: (key: string) => Promise<{ readonly size: number } | undefined>;
};
export type HostFiles = {
  readonly upload: (request: Request, person: Person) => Promise<Response>;
  readonly download: (request: Request, person: Person) => Promise<Response>;
  readonly env: (person: Person) => ExecutionEnv;
};
export type CreateHostFiles = (options: { readonly fs: FileSystem; readonly store: BlobStore; readonly maxUploadBytes?: number }) => HostFiles;

/** Item 6b. Who is acting for one tool call: the per-call record, holding `requestedBy` only. */
export type Actor = { readonly requestedBy: string };
export class SenderUnknown extends Error { constructor(readonly callId: string) { super('sender-unknown'); } }
export type Acting = (call: ToolExecutionApi, context: Context) => Promise<Actor>;

/** Item 7. One agent's Domain tools, as one Extension named `host.tools.<agent>`. */
export type AppTools = (input: {
  readonly def: AppDefinition;
  readonly api?: Toolable | undefined;
  readonly agent: string;
  readonly scope: Scope | undefined;
  readonly services?: (() => EffectContext.Context<any>) | undefined;
  /** The plain operations' storage: one unit's own, by unit key. Required when the agent lists a plain operation. */
  readonly storage?: ((unit: string) => UnitStorage) | undefined;
  readonly caps?: Partial<CapabilityMethods> | undefined;
  readonly attribution: Acting;
  readonly commandId?: (call: ToolExecutionApi, context: Context) => Promise<string>;
}) => Extension;
export type CheckExpose = (def: AppDefinition) => void;
export type CheckAgentTools = (def: AppDefinition, agents: Readonly<Record<string, DefinedAgent>>) => void;

/** Item 11. */
export type ModelRoute = (input: {
  readonly routes: readonly RouteName[];
  readonly secret: SecretByName;
  readonly modelIds?: Partial<Readonly<Record<RouteName, string>>>;
  readonly beforeAttempt?: (attempt: { readonly route: RouteName; readonly signal: AbortSignal }) => Promise<void>;
  readonly baseUrls?: Partial<Readonly<Record<RouteName, string>>>;
}) => { readonly models: Models; readonly model: { readonly provider: string; readonly modelId: string } };
