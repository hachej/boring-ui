declare const sessionId: string
declare const workspaceScopeId: string

export const streamPath = `legacy/${JSON.stringify([sessionId, workspaceScopeId, ''])}`
