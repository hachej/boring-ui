import type { FastifyRequest } from "fastify";
import { fileURLToPath } from "node:url";
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "@hachej/boring-workspace/server";
import { BROWSER_BASE_PATH, BROWSER_TOOL_NAMES } from "../shared";
import {
  BrowserController,
  type BrowserAdmission,
  type BrowserAudit,
  type BrowserExec,
  type BrowserEnvironmentHandle,
  type BrowserPlanAdmission,
  type BrowserScope,
} from "./controller";
export * from "./controller";

export type BrowserScopeResolver = (
  request: FastifyRequest,
) => Promise<BrowserScope> | BrowserScope;
export interface BrowserServerPluginOptions {
  enabled?: boolean;
  exec: BrowserExec;
  admitPlan: BrowserPlanAdmission;
  admit: BrowserAdmission;
  resolveScope: BrowserScopeResolver;
  resolveToolScope: (
    context: Readonly<{
      workspaceId?: string;
      userId?: string;
      sessionId?: string;
    }>,
  ) => Promise<BrowserScope> | BrowserScope;
  audit?: BrowserAudit;
  acquire: (scope: BrowserScope) => Promise<BrowserEnvironmentHandle>;
  revokeView: (scope: BrowserScope, sessionId: string) => void | Promise<void>;
  redactText: (value: string, field: "title" | "role" | "element-text") => string | undefined;
  now?: () => number;
}
export function createBrowserServerPlugin(
  options: BrowserServerPluginOptions,
): WorkspaceServerPlugin {
  if (options.enabled === true || process.env.BORING_BROWSER_PLUGIN_ENABLED === "1") {
    throw new Error("Browser integration is not security-qualified; production remains disabled");
  }
  const enabled = false;
  const controller = new BrowserController(options);
  const requireEnabled = () => {
    if (!enabled) throw new Error("Browser plugin is disabled");
  };
  return defineServerPlugin({
    id: "browser",
    label: "Browser",
    systemPrompt:
      "Use only browser_observe and browser_act for an already-started Browser panel session. Browser-Use is the bounded mechanism, not another Agent or model. Never request credentials in tool arguments.",
    skills: [
      {
        name: "browser-use",
        source: fileURLToPath(
          new URL("../runtime/skill/SKILL.md", import.meta.url),
        ),
      },
    ],
    assets: [
      {
        name: "browser-runtime",
        source: fileURLToPath(new URL("../runtime", import.meta.url)),
      },
    ],
    agentTools: [
      {
        name: BROWSER_TOOL_NAMES[0],
        description: "Observe the current agent-controlled browser session.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId", "controlEpoch"],
          properties: {
            sessionId: { type: "string", minLength: 1, maxLength: 256 },
            controlEpoch: { type: "integer", minimum: 0 },
          },
        },
        async execute(params, ctx) {
          try {
            requireEnabled();
            const scope = await options.resolveToolScope(ctx);
            return ok(
              await controller.observe(
                scope,
                String(params.sessionId),
                Number(params.controlEpoch),
              ),
            );
          } catch (error) {
            return fail(error);
          }
        },
      },
      {
        name: BROWSER_TOOL_NAMES[1],
        description: "Execute one immutable admitted browser action plan.",
        parameters: actionPlanSchema,
        async execute(params, ctx) {
          try {
            requireEnabled();
            const scope = await options.resolveToolScope(ctx);
            return ok(await controller.act(scope, params, ctx.abortSignal, { toolCallId: ctx.toolCallId, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }));
          } catch (error) {
            return fail(error);
          }
        },
      },
    ],
    routes: async (app) => {
      app.addHook("onClose", async () => {
        await controller.shutdown();
      });
      app.post(`${BROWSER_BASE_PATH}/start`, async (request) => {
        requireEnabled();
        const scope = await options.resolveScope(request);
        assertScopeBody(request.body, scope);
        return controller.start(scope);
      });
      app.post(`${BROWSER_BASE_PATH}/status`, async (request) => {
        requireEnabled();
        const scope = await options.resolveScope(request);
        return controller.status(scope, sessionId(request.body));
      });
      app.post(`${BROWSER_BASE_PATH}/stop`, async (request) => {
        requireEnabled();
        const scope = await options.resolveScope(request);
        return controller.stop(scope, sessionId(request.body));
      });
      app.post(`${BROWSER_BASE_PATH}/takeover`, async (request) => {
        requireEnabled();
        const scope = await options.resolveScope(request);
        return controller.takeover(scope, sessionId(request.body));
      });
      app.post(`${BROWSER_BASE_PATH}/return`, async (request) => {
        requireEnabled();
        const scope = await options.resolveScope(request);
        const body = strict(request.body, ["sessionId", "consent"]);
        if (body.consent !== true)
          throw new Error("Informed return consent is required");
        return controller.return(scope, String(body.sessionId), true);
      });
      app.post(`${BROWSER_BASE_PATH}/view`, async (request) => {
        requireEnabled();
        const scope = await options.resolveScope(request);
        return controller.status(scope, sessionId(request.body));
      });
    },
  });
}
function strict(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid browser request");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !keys.includes(key)))
    throw new Error("Unsupported browser request field");
  return body;
}
function sessionId(value: unknown): string {
  const body = strict(value, ["sessionId"]);
  if (typeof body.sessionId !== "string" || !body.sessionId)
    throw new Error("Invalid browser session");
  return body.sessionId;
}
function assertScopeBody(value: unknown, scope: BrowserScope): void {
  const body = strict(value, ["agentId", "agentSessionId"]);
  if (
    body.agentId !== scope.agentId ||
    body.agentSessionId !== scope.agentSessionId
  )
    throw new Error(
      "Addressed Agent identity did not match authenticated scope",
    );
}
function ok(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}
function fail(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error && error.message === "Browser plugin is disabled"
          ? error.message
          : "Browser operation was rejected.",
      },
    ],
    isError: true,
  };
}
const target = {
  type: "object",
  additionalProperties: false,
  required: ["index"],
  properties: { index: { type: "integer", minimum: 0, maximum: 10000 } },
};
const actionPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId", "controlEpoch", "actions"],
  properties: {
    sessionId: { type: "string", minLength: 1, maxLength: 256 },
    controlEpoch: { type: "integer", minimum: 0 },
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "url"],
            properties: {
              kind: { const: "navigate" },
              url: { type: "string", maxLength: 2048 },
            },
          },
          ...["click"].map((kind) => ({
            type: "object",
            additionalProperties: false,
            required: ["kind", "target"],
            properties: { kind: { const: kind }, target },
          })),
          ...[
            ["type", "text"],
            ["select", "value"],
          ].map(([kind, field]) => ({
            type: "object",
            additionalProperties: false,
            required: ["kind", "target", field],
            properties: {
              kind: { const: kind },
              target,
              [field!]: { type: "string", maxLength: 8192 },
            },
          })),
        ],
      },
    },
  },
};
