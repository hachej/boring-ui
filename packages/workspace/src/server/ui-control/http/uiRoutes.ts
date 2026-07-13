import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, type ZodSchema } from "zod";
import type { UiBridge, UiCommand } from "../../../shared/ui-bridge";
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
}

export function uiRoutes(
  app: FastifyInstance,
  opts: UiRoutesOptions,
  done: (err?: Error) => void,
): void {
  const fallbackBridge = opts.bridge;
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
      const current = (await bridge.getState()) ?? {};
      const preserveStateKeys = opts.getPreserveStateKeys
        ? await opts.getPreserveStateKeys(request)
        : opts.preserveStateKeys ?? [];
      const preserved = Object.fromEntries(
        preserveStateKeys
          .filter((key) => !(key in body.state) && key in current)
          .map((key) => [key, current[key]]),
      );
      await bridge.setState({ ...body.state, ...preserved });
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/ui/commands",
    { preHandler: validatePostCommand },
    async (request) => {
      const body = request.body as z.infer<typeof postCommandBodySchema>;
      const bridge = await resolveBridge(request);
      const cmd: UiCommand = { kind: body.kind, params: body.params };
      return await bridge.postCommand(cmd);
    },
  );

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
    reply.raw.write(
      `event: init\ndata: ${JSON.stringify({ v: UI_BRIDGE_PROTOCOL_VERSION })}\n\n`,
    );

    // Drain any commands queued BEFORE this subscriber connected. Without
    // this, a command posted in the gap between page-reload and EventSource-
    // reconnect is silently dropped: postCommand broadcasts to the (empty)
    // subscriber set, the message lands in pendingCommands, and the next
    // subscriber only sees future broadcasts. Tests that bootClean → POST
    // openPanel hit this race when Vite is cold.
    if (bridge.drainCommands) {
      const queued = await bridge.drainCommands();
      for (const cmd of queued) {
        reply.raw.write(
          `event: command\ndata: ${JSON.stringify(encodeCommand(cmd))}\n\n`,
        );
      }
    }

    const unsub = bridge.subscribeCommands((cmd) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return false;
      try {
        reply.raw.write(`event: command\ndata: ${JSON.stringify(encodeCommand(cmd))}\n\n`);
        return true;
      } catch {
        return false;
      }
    });
    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) return;
      void touchUi(request);
      reply.raw.write(
        `event: heartbeat\ndata: ${JSON.stringify({ v: UI_BRIDGE_PROTOCOL_VERSION })}\n\n`,
      );
    }, HEARTBEAT_MS);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsub();
    });

    reply.hijack();
  });

  done();
}
