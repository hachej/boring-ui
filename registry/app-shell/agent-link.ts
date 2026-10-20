// Host concern: launch URLs select the shell's existing agent layer, never an agent runtime or permission.
export interface AgentLink {
  readonly agent: 'coach' | 'agent' | 'improve';
  readonly open?: 'half' | 'full';
  readonly input?: 'text' | 'voice';
}

/** Known shell targets only. Missing or invalid presentation options default to full and text; voice always opens full. */
export function parseAgentLink(search: string): Required<AgentLink> | null {
  const params = new URLSearchParams(search);
  const agent = params.get('agent');
  if (agent !== 'coach' && agent !== 'agent' && agent !== 'improve') return null;
  const input = params.get('input') === 'voice' ? 'voice' : 'text';
  return { agent, open: input === 'voice' || params.get('open') !== 'half' ? 'full' : 'half', input };
}

/** The query for an app-owned manifest shortcut or start_url. Recording still needs the person's press. */
export function agentLink({ agent, open = 'full', input = 'text' }: AgentLink): string {
  return `?${new URLSearchParams({ agent, open: input === 'voice' ? 'full' : open, input })}`;
}
