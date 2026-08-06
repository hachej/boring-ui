export const SESSION_CREATE_PROTOCOL_ERROR = "SESSION_CREATE_PROTOCOL_ERROR" as const

export type SessionCreateProtocolError = Error & {
  code: typeof SESSION_CREATE_PROTOCOL_ERROR
}
