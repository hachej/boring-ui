import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, type ZodSchema } from "zod";
import type { SequencedUiCommand, UiBridge, UiCommand } from "../../../shared/ui-bridge";
import { updateUiState } from "../../bridge/updateUiState";
import { resolveUrlPaneTarget, URL_PANE_PANEL_ID, type UrlPanePolicy } from "../../../shared/urlPane";
import { resolveUrlPanePolicyFromEnv } from "../urlPanePolicy";
import { createPaneRenderStatusStore, type PaneRenderStatusStore } from "../panelStatus/paneRenderStatusStore";
import { paneRenderStatusRoutes, resolvePaneStatusWorkspaceId } from "./paneRenderStatusRoutes";

const UI_BRIDGE_PROTOCOL_VERSION = 1;
const HEARTBEAT_MS = 15_000;

const setStateBodySchema = z.object({
  state: z.record(z.unknown()),
  causedBy: z.enum(["user", "agent", "restore"]).optional(),
});

const postCommandBodySchema = z.object({
  kind: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

// Inlined to avoid pulling on @hachej/boring-agent's internal http/middleware module.
function createBodyValidator<T>(schema: ZodSchema<T>) {
  return async function validateBody(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const fieldName = firstIssue?.path
        ?.map((segment: string | number) => String(segment))
        .join(".");
      reply.code(400).send({
        error: "validation_error",
        message: firstIssue?.message ?? "Invalid request body",
        field: fieldName || undefined,
      });
      return;
    }
    request.body = parsed.data;
  };
}

export interface UiRoutesOptions {
  bridge?: UiBridge;
  getBridge?: (request: FastifyRequest) => UiBridge | Promise<UiBridge>;
  getWorkspaceId?: (request: FastifyRequest, presentedWorkspaceId?: unknown) => string | undefined | Promise<string | undefined>;
  /**
   * Server/plugin-owned state slots preserved across browser full-state PUTs.
   * Browser UI snapshots are replace-style for normal workspace state, but
   * these slots are published out-of-band by server plugins.
   */
  preserveStateKeys?: string[];
  getPreserveStateKeys?: (request: FastifyRequest) => string[] | Promise<string[]>;
  paneStatusStore?: PaneRenderStatusStore;
  /**
   * Origin allowlist the URL pane may embed. Defaults to the env-resolved
   * policy (loopback only unless the host opts in).
   */
  urlPanePolicy?: UrlPanePolicy;
}

type UiCommandStreamSink = {
  isOpen(): boolean;
  onReady(): void;
  onCommand(command: SequencedUiCommand): boolean;
};

export async function subscribeUiCommandStream(
  bridge: UiBridge,
  sink: UiCommandStreamSink,
): Promise<() => void> {
  if (!sink.isOpen()) return () => undefined;
  sink.onReady();
  if (!sink.isOpen()) return () => undefined;

  // The canonical bridge subscribes before synchronously replaying queued
  // commands, so rejected writes retain their original sequence identity.
  const unsubscribe = bridge.subscribeCommands((command) => (
    sink.isOpen() ? sink.onCommand(command) : false
  ));
  if (sink.isOpen()) return unsubscribe;
  unsubscribe();
  return () => undefined;
}

/**
 * The URL pane's origin rule is enforced in the front, which is the only thing
 * that renders an iframe. Rejecting the command here as well is defence in
 * depth *and* ergonomics: an agent that asks for a disallowed origin gets a 400
 * with the reason instead of a silently blocked pane it cannot see.
 */
function urlPaneCommandRejection(cmd: UiCommand, policy: UrlPanePolicy): string | undefined {
  if (cmd.kind !== "openPanel") return undefined;
  const params = cmd.params as { component?: unknown; params?: { url?: unknown } } | undefined;
  if (params?.component !== URL_PANE_PANEL_ID) return undefined;
  const url = params.params?.url;
  const resolved = resolveUrlPaneTarget(typeof url === "string" ? url : "", policy);
  return resolved.ok ? undefined : resolved.message;
}

export function uiRoutes(
  app: FastifyInstance,
  opts: UiRoutesOptions,
  done: (err?: Error) => void,
): void {
  const fallbackBridge = opts.bridge;
  const urlPanePolicy = opts.urlPanePolicy ?? resolveUrlPanePolicyFromEnv();
  const paneStatusStore = opts.paneStatusStore ?? createPaneRenderStatusStore();
  const getPaneWorkspaceId = async (request: FastifyRequest, presentedWorkspaceId?: unknown) => (await opts.getWorkspaceId?.(request, presentedWorkspaceId)) ?? resolvePaneStatusWorkspaceId(request);
  const touchUi = async (request: FastifyRequest) => {
    paneStatusStore.touchUi(await getPaneWorkspaceId(request));
  };
  const validateSetState = createBodyValidator(setStateBodySchema);
  const validatePostCommand = createBodyValidator(postCommandBodySchema);
  const resolveBridge = async (request: FastifyRequest): Promise<UiBridge> => {
    if (opts.getBridge) return await opts.getBridge(request);
    if (fallbackBridge) return fallbackBridge;
    throw new Error("uiRoutes requires bridge or getBridge");
  };
  const encodeCommand = (cmd: UiCommand & { seq: number }) => ({
    v: UI_BRIDGE_PROTOCOL_VERSION,
    seq: cmd.seq,
    kind: cmd.kind,
    params: cmd.params,
  });

  paneRenderStatusRoutes(app, { store: paneStatusStore, getWorkspaceId: getPaneWorkspaceId }, () => {});

  app.get("/api/v1/ui/state", async (request) => {
    await touchUi(request);
    const bridge = await resolveBridge(request);
    return (await bridge.getState()) ?? {};
  });

  app.put(
    "/api/v1/ui/state",
    { preHandler: validateSetState },
    async (request, reply) => {
      await touchUi(request);
      const body = request.body as z.infer<typeof setStateBodySchema>;
      const bridge = await resolveBridge(request);
      const preserveStateKeys = opts.getPreserveStateKeys
        ? await opts.getPreserveStateKeys(request)
        : opts.preserveStateKeys ?? [];
      await updateUiState(bridge, (current) => {
        const next = { ...body.state };
        for (const key of preserveStateKeys) {
          delete next[key];
          if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
        }
        return next;
      });
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/ui/commands",
    { preHandler: validatePostCommand },
    async (request, reply) => {
      const body = request.body as z.infer<typeof postCommandBodySchema>;
      const bridge = await resolveBridge(request);
      const cmd: UiCommand = { kind: body.kind, params: body.params };
      const rejection = urlPaneCommandRejection(cmd, urlPanePolicy);
      if (rejection) {
        return reply.code(400).send({ error: "url_pane_origin_not_allowed", message: rejection });
      }
      return await bridge.postCommand(cmd);
    },
  );

  // The front fetches this to enforce the same rule before it sets an iframe
  // src, and to render an actionable "blocked" state naming the allowlist.
  app.get("/api/v1/ui/url-pane/policy", async () => ({ origins: urlPanePolicy.origins }));

  app.get("/api/v1/ui/commands/next", async (request, reply) => {
    await touchUi(request);
    const bridge = await resolveBridge(request);
    const query = request.query as Record<string, string>;

    if (query.poll === "true") {
      const batch = bridge.drainCommands
        ? await bridge.drainCommands()
        : [];
      return batch.map(encodeCommand);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const writeCommand = (cmd: SequencedUiCommand): boolean => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return false;
      try {
        reply.raw.write(`event: command\ndata: ${JSON.stringify(encodeCommand(cmd))}\n\n`);
        return true;
      } catch {
        return false;
      }
    };
    let unsub: () => void = () => undefined;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (heartbeat) clearInterval(heartbeat);
      unsub();
    };
    request.raw.once("close", cleanup);
    reply.raw.once("close", cleanup);

    unsub = await subscribeUiCommandStream(bridge, {
      isOpen: () => !cleanedUp && !reply.raw.destroyed && !reply.raw.writableEnded,
      onReady: () => {
        // Establish the connection-ready handshake before subscribeCommands
        // synchronously replays queued commands.
        reply.raw.write(
          `event: init\ndata: ${JSON.stringify({ v: UI_BRIDGE_PROTOCOL_VERSION })}\n\n`,
        );
      },
      onCommand: writeCommand,
    });
    if (cleanedUp || reply.raw.destroyed || reply.raw.writableEnded) {
      unsub();
      reply.hijack();
      return;
    }

    heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) return;
      void touchUi(request);
      reply.raw.write(
        `event: heartbeat\ndata: ${JSON.stringify({ v: UI_BRIDGE_PROTOCOL_VERSION })}\n\n`,
      );
    }, HEARTBEAT_MS);

    // `reply.raw` is the authoritative lifetime of this long-lived response.
    // Behind a dev/reverse proxy the request body can remain open even after
    // the downstream EventSource closes, stranding upstream SSE connections.
    reply.hijack();
  });

  done();
}
