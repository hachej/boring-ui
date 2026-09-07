declare const identity: { workspaceScopeId: string; sessionId: string }
declare function sessionStreamPath(input: typeof identity): string

export const forbidden = sessionStreamPath(identity)
