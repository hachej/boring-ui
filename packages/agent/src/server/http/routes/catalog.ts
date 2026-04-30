import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AgentTool } from "../../../shared/tool.js";

export interface CatalogRoutesOptions {
  tools?: AgentTool[];
  getTools?: (request: FastifyRequest) => AgentTool[] | Promise<AgentTool[]>;
}

export function catalogRoutes(
  app: FastifyInstance,
  opts: CatalogRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.get("/api/v1/agent/catalog", async (request) => {
    const tools = opts.getTools ? await opts.getTools(request) : opts.tools ?? []
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };
  });

  done();
}
