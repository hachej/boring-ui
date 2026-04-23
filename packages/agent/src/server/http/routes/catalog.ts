import type { FastifyInstance } from "fastify";
import type { AgentTool } from "../../../shared/tool.js";

export interface CatalogRoutesOptions {
  tools: AgentTool[];
}

export function catalogRoutes(
  app: FastifyInstance,
  opts: CatalogRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.get("/api/v1/agent/catalog", async () => {
    return {
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };
  });

  done();
}
