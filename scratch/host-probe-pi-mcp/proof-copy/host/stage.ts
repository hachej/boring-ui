// What every app's stack knows about its stages and names (the platform's "create app" in embryo, part 1).
// One app = one Alchemy stack named after its prefix; stages: `staging`, `production`, and previews `pr-<branch>`.
import { Stage } from "alchemy";
import * as Effect from "effect/Effect";

export interface AppSpec {
  /** The app's short name (`<name>`): its address would be `<name>.boringbots.ai`. */
  readonly name: string;
  /** Every physical name on Cloudflare starts with it (the Alchemy stack is named after it). */
  readonly prefix: string;
}

export const isPreview = (stage: string) => /^pr-[a-z0-9-]{1,20}$/.test(stage);
export const assertStage = (stage: string) => {
  if (stage === "staging" || stage === "production" || isPreview(stage)) return stage;
  throw new Error(`unknown stage '${stage}': staging, production or pr-<branch>`);
};

/** The Worker's props for a stage: its own script on staging and production, a Preview of the staging script on `pr-*`. */
export const workerProps = (app: AppSpec, main: string, extra: Record<string, unknown> = {}) => Effect.gen(function* () {
  const stage = assertStage(yield* Stage);
  const base = {
    main,
    compatibility: { date: "2026-10-01", flags: ["nodejs_compat"] },
    // the person's objects run the new code right after a deploy (the default keeps old code up to 5 minutes)
    codeUpdateStrategy: { mode: "immediate" as const },
    observability: { enabled: true, logs: { enabled: true, invocationLogs: false, persist: true, headSamplingRate: 1 } },
    ...extra,
    ...(process.env.BORING_DEBUG ? (console.error("[stage] extra keys", Object.keys(extra)), {}) : {}),
  };
  if (isPreview(stage)) return { ...base, preview: { of: `${app.prefix}-staging`, name: stage, message: `preview ${stage}`, tag: process.env.BORING_COMMIT?.slice(0, 12) } };
  // the production address `<name>.boringbots.ai` is planned only, behind a flag (line 8); the spike never applies it
  const domain = stage === "production" && process.env.BORING_PLAN_DOMAIN === "1" ? { domain: `${app.name}.boringbots.ai` } : {};
  return { ...base, name: `${app.prefix}-${stage}`, ...domain };
});
