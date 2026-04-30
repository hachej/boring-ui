import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, type ZodSchema } from "zod";
import type { UiBridge, UiCommand } from "../../../shared/ui-bridge";

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

// Inlined to avoid pulling on @boring/agent's internal http/middleware module.
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
  bridge: UiBridge;
}

export function uiRoutes(
  app: FastifyInstance,
  opts: UiRoutesOptions,
  done: (err?: Error) => void,
): void {
  const { bridge } = opts;
  const validateSetState = createBodyValidator(setStateBodySchema);
  const validatePostCommand = createBodyValidator(postCommandBodySchema);
  const encodeCommand = (cmd: UiCommand & { seq: number }) => ({
    v: UI_BRIDGE_PROTOCOL_VERSION,
    seq: cmd.seq,
    kind: cmd.kind,
    params: cmd.params,
  });

  app.get("/api/v1/ui/state", async () => {
    return (await bridge.getState()) ?? {};
  });

  app.put(
    "/api/v1/ui/state",
    { preHandler: validateSetState },
    async (request, reply) => {
      const body = request.body as z.infer<typeof setStateBodySchema>;
      await bridge.setState(body.state);
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/ui/commands",
    { preHandler: validatePostCommand },
    async (request) => {
      const body = request.body as z.infer<typeof postCommandBodySchema>;
      const cmd: UiCommand = { kind: body.kind, params: body.params };
      return await bridge.postCommand(cmd);
    },
  );

  app.get("/api/v1/ui/commands/next", async (request, reply) => {
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
      reply.raw.write(`event: command\ndata: ${JSON.stringify(encodeCommand(cmd))}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) return;
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
