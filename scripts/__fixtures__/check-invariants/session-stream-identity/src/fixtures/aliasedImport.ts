import { sessionStreamPath as makePath } from '@hachej/boring-agent/shared/events'

declare const identity: { workspaceScopeId: string; sessionId: string }

export const forbidden = makePath(identity)
