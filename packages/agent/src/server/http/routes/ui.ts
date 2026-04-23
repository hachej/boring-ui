import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { UiBridge, UiCommand } from "../../../shared/ui-bridge.js";
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION_ERROR,
} from "../middleware.js";

const setStateBodySchema = z.object({
  state: z.record(z.unknown()),
  causedBy: z.enum(["user", "agent", "restore"]).optional(),
});

const postCommandBodySchema = z.object({
  kind: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

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
      const batch: Array<UiCommand & { seq: number }> = [];
      const unsub = bridge.subscribeCommands((cmd) => batch.push(cmd));
      unsub();
      return { commands: batch };
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(":\n\n");

    const unsub = bridge.subscribeCommands((cmd) => {
      reply.raw.write(`event: command\ndata: ${JSON.stringify(cmd)}\n\n`);
    });

    request.raw.on("close", () => {
      unsub();
    });

    reply.hijack();
  });

  done();
}
