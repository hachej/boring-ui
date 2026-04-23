import { z } from "zod"

export const RuntimeModeSchema = z.enum(["direct", "local", "vercel-sandbox"])
export type RuntimeModeId = z.infer<typeof RuntimeModeSchema>

export const ConfigSchema = z.object({
  workspaceRoot: z.string(),
  workspaceId: z.string(),
  port: z.number().int().positive(),
  mode: RuntimeModeSchema,
  model: z.string().optional(),
  noOpen: z.boolean(),
  noGitignore: z.boolean(),
  dev: z.boolean(),
  verbose: z.boolean(),
})

export type AgentConfig = z.infer<typeof ConfigSchema>

export const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  BORING_AGENT_MODE: RuntimeModeSchema.optional(),
  BORING_AGENT_WORKSPACE_ROOT: z.string().optional(),
  BORING_AGENT_PORT: z.coerce.number().int().positive().optional(),
  BORING_AGENT_TEMPLATE_PATH: z.string().optional(),
  BORING_AGENT_VERBOSE: z.enum(["0", "1"]).optional(),
  BORING_AGENT_MODEL: z.string().optional(),
  BORING_AGENT_CONFIG: z.string().optional(),
  BORING_AGENT_DEV: z.enum(["0", "1"]).optional(),
  BORING_AGENT_NO_OPEN: z.enum(["0", "1"]).optional(),
  BORING_AGENT_NO_GITIGNORE: z.enum(["0", "1"]).optional(),
  BORING_AGENT_SNAPSHOT_KEEP: z.coerce.number().int().nonnegative().optional(),
  VERCEL_OIDC_TOKEN: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
})

export type AgentEnv = z.infer<typeof EnvSchema>

export function validateConfig(config: unknown): AgentConfig {
  return ConfigSchema.parse(config)
}
