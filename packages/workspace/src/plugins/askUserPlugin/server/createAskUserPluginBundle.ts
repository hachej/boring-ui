import { join } from "node:path"
import type { UiBridge } from "../../../shared/ui-bridge"
import type { WorkspaceServerPlugin } from "../../../server/plugins/bootstrapServer"
import { FileAskUserStore, type AskUserStore } from "./AskUserStore"
import { AskUserRuntime } from "./AskUserRuntime"
import { AskUserStatePublisher } from "./AskUserStatePublisher"
import { createAskUserServerPlugin } from "./askUserServerPlugin"

export type AskUserPluginBundleOptions = {
  workspaceRoot: string
  bridge: UiBridge
  sessionId?: string | (() => string)
  store?: AskUserStore
}

export function createAskUserPluginBundle(options: AskUserPluginBundleOptions): WorkspaceServerPlugin {
  const store = options.store ?? new FileAskUserStore(join(options.workspaceRoot, ".boring", "ask-user.json"))
  const runtime = new AskUserRuntime({ store, uiBridge: options.bridge })
  const stopPublisher = new AskUserStatePublisher(store, options.bridge).start()
  return createAskUserServerPlugin({
    store,
    runtime,
    sessionId: options.sessionId ?? (() => "default"),
    onClose: stopPublisher,
    routes: {
      // No-auth playground/default shells still need the browser command channel to
      // bind to the question's owning session. The answerToken remains the terminal
      // mutation secret; this context only prevents the default anonymous session
      // sentinel from rejecting legitimate no-auth submits as SESSION_MISMATCH.
      getAuthContext: (request) => {
        const body = request.body as { params?: { sessionId?: unknown } } | undefined
        return {
          sessionId: typeof body?.params?.sessionId === "string" ? body.params.sessionId : "anonymous",
          principalId: "anonymous",
        }
      },
    },
  })
}
