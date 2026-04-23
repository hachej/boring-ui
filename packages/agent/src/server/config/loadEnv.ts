import { z } from "zod"
import { EnvSchema, type AgentEnv } from "../../shared/config-schema.js"

function pickEnvKeys(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const pick: Record<string, string | undefined> = {}
  for (const key of Object.keys(EnvSchema.shape)) {
    if (key in env) pick[key] = env[key]
  }
  return pick
}

export function loadEnv(
  env: Record<string, string | undefined> = process.env,
): AgentEnv {
  return EnvSchema.parse(pickEnvKeys(env))
}

export function loadEnvSafe(
  env: Record<string, string | undefined> = process.env,
): { success: true; data: AgentEnv } | { success: false; error: z.ZodError } {
  return EnvSchema.safeParse(pickEnvKeys(env))
}
