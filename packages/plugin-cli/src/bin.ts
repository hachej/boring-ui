#!/usr/bin/env node
import { runBoringUiPluginCli } from "./index"

runBoringUiPluginCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
