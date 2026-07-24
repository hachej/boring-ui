export interface AgentShutdownParticipant {
  /** Stop admitting host-plugin background work. This runs in Fastify preClose and must return promptly. */
  begin(): void | Promise<void>
  /** Drain admitted work before runtime binding admission closes. This runs in untimed onClose. */
  drain(): Promise<void>
}
