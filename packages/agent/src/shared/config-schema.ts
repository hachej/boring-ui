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
  BORING_AGENT_MODE: RuntimeModeSchema.optional(),
  BORING_AGENT_WORKSPACE_ROOT: z.string().optional(),
  BORING_AGENT_PORT: z.coerce.number().int().positive().optional(),
  BORING_AGENT_TEMPLATE_PATH: z.string().optional(),
  BORING_AGENT_VERBOSE: z.enum(["0", "1"]).optional(),
  BORING_AGENT_MODEL: z.string().optional(),
  BORING_AGENT_DEFAULT_MODEL: z.string().optional(),
  BORING_AGENT_DEFAULT_MODEL_PROVIDER: z.string().optional(),
  BORING_AGENT_DEFAULT_MODEL_ID: z.string().optional(),
  BORING_AGENT_INFOMANIAK_PROVIDER: z.string().optional(),
  BORING_AGENT_INFOMANIAK_PRODUCT_ID: z.string().optional(),
  BORING_AGENT_INFOMANIAK_BASE_URL: z.string().url().optional(),
  BORING_AGENT_INFOMANIAK_MODEL: z.string().optional(),
  BORING_AGENT_INFOMANIAK_MODEL_NAME: z.string().optional(),
  BORING_AGENT_INFOMANIAK_API_KEY_ENV: z.string().optional(),
  BORING_AGENT_INFOMANIAK_API_KEY: z.string().optional(),
  BORING_AGENT_CUSTOM_MODEL_PROVIDER: z.string().optional(),
  BORING_AGENT_CUSTOM_MODEL_ID: z.string().optional(),
  BORING_AGENT_CUSTOM_MODEL_NAME: z.string().optional(),
  BORING_AGENT_CUSTOM_MODEL_BASE_URL: z.string().url().optional(),
  BORING_AGENT_CUSTOM_MODEL_API_KEY_ENV: z.string().optional(),
  BORING_AGENT_CUSTOM_MODEL_API_KEY: z.string().optional(),
  BORING_AGENT_CONFIG: z.string().optional(),
  BORING_AGENT_DEV: z.enum(["0", "1"]).optional(),
  BORING_AGENT_NO_OPEN: z.enum(["0", "1"]).optional(),
  BORING_AGENT_NO_GITIGNORE: z.enum(["0", "1"]).optional(),
  BORING_AGENT_SNAPSHOT_KEEP: z.coerce.number().int().nonnegative().optional(),
  BORING_AGENT_PYTHON_PACKAGES: z.string().optional(),
  VERCEL_OIDC_TOKEN: z.string().optional(),
  VERCEL_ACCESS_TOKEN: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
  VERCEL_PROJECT_ID: z.string().optional(),
  BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
})

export type AgentEnv = z.infer<typeof EnvSchema>

export function validateConfig(config: unknown): AgentConfig {
  return ConfigSchema.parse(config)
}
