// The seams several host slices share (README "Shared contract", items 1, 2, 6, 9, 10 and the route names of 11). Types only:
// `./host` loads no pi-durable runtime module.
import type { Harness, HarnessOptions, Storage } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord/context';
import type * as Effect from 'effect/Effect';
import type { AppDefinition, AppWords, KitLanguage, Languages, ViewProps } from './define-app.js';

/** Item 1. Only the generated entry opens a Harness (BORING-PI-2); packages borrow it. The arguments are pi's own `Harness.open`. */
export type OpenHarness = (storage: Storage, options: HarnessOptions, context: Context) => Promise<Harness>;

/** Item 2. The person, as the Worker checked them. `language` is read by the host from the person's record at every request. */
export type Person = { readonly id: string; readonly language: KitLanguage };
export type ResolveLanguage = (personId: string) => Promise<KitLanguage>;

/** Item 6. The approval record of one write, beside the per-call record and never in it. */
export type WriteAttribution = {
  readonly requestedBy: string;
  readonly approvedBy?: string;
  readonly decisionId?: string;
};

/** Item 9. The host's secret lookup by name. */
export type SecretByName = (name: string) => Promise<string | undefined>;

/** Item 10. What the caller bundled for the Worker. */
export type Assets = {
  readonly page: string;
  readonly skills: Readonly<Record<string, Readonly<Record<string, string>>>>;
};
export type RouteName = 'relay' | 'openrouter';
export type MountOptions = {
  readonly main: string;
  readonly openHarness: OpenHarness;
  readonly worker: Record<string, unknown> | Effect.Effect<Record<string, unknown>, never, any>;
  readonly routes?: (request: Request, person: Person | undefined) => Promise<Response | undefined>;
  readonly health?: Readonly<Record<string, unknown>>;
  readonly signUp?: boolean;
  readonly testRoutes?: boolean;
  readonly modelRoutes?: readonly RouteName[];
  readonly secrets?: { readonly store: string; readonly prefix: string };
};
/** What an options module's default export is: the mount options the stack computes, without the two the generated entry supplies. */
export type HostOptions = Omit<MountOptions, 'main' | 'openHarness'>;
/** An Alchemy Worker class; `unknown` here because its type is `@alchemy.run/cloudflare`'s, which `./host` may not import. */
export type MountApp = (def: AppDefinition, assets: Assets, options: MountOptions) => unknown;
export type AppHostProps<W extends AppWords = AppWords> = {
  readonly name: string;
  readonly languages: Languages<W>;
  readonly views: readonly { readonly id: string; readonly component: (props: ViewProps<W>) => unknown }[];
};
/** The text of `.gen/server.ts`. There is one path: the options module is required, because `MountOptions.worker` is. */
export type HostEntry = (optionsSpecifier: string) => string;
/** `options` is required; the build refuses, with one sentence, when it is missing. */
export type HostBuild = (appDir: string, flags: { readonly shell?: string; readonly page?: string; readonly options: string; readonly stack?: string }) => Promise<void>;
