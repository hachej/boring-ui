// The one stack function: the app's Worker, its credentials by name, Alchemy's state in a store of this app's own on Cloudflare
// (local state for `alchemy dev`). The stack is named `<spike>-<app name>`, so every physical name starts with the spike's prefix.
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AppDefinition } from "../contract/define-app.ts";
import { SPIKE } from "./config.ts";
import { assertStage, isPreview } from "./stage.ts";

export const appStack = <W extends { url: { as<T>(): unknown } }>(def: AppDefinition, worker: Effect.Effect<W, never, any>) => {
  const prefix = `${SPIKE}-${def.name}`;
  return Alchemy.Stack(prefix, {
    providers: Layer.mergeAll(Cloudflare.providers(), DomainCloudflare.providers()),
    state: process.env.BORING_LOCAL === "1" ? Alchemy.localState() : Cloudflare.state({ workerName: `${prefix}-state` }),
  }, Effect.gen(function* () {
    const stage = assertStage(yield* Alchemy.Stage);
    const w = yield* worker;
    return { url: w.url.as<string>(), stage, preview: isPreview(stage) };
  }) as never);
};
