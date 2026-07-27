import type { AddressedAgentOption } from '../useAddressedAgentSelection'

export interface AgentSelectionControlProps {
  agents: AddressedAgentOption[]
  selectedAgentTypeId?: string
  loading: boolean
  error?: Error
  onSelect: (agentTypeId: string) => void
}

export function AgentSelectionControl({
  agents,
  selectedAgentTypeId,
  loading,
  error,
  onSelect,
}: AgentSelectionControlProps) {
  const placeholder = loading ? 'Loading agents…' : error ? 'Agents unavailable' : 'No agents available'
  return (
    <label
      data-boring-agent-part="agent-selection"
      className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground"
    >
      <span>Agent</span>
      <select
        aria-label="Agent"
        className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-foreground md:min-h-0"
        value={selectedAgentTypeId ?? ''}
        disabled={agents.length === 0}
        onChange={(event) => onSelect(event.currentTarget.value)}
      >
        {agents.length === 0 ? <option value="">{placeholder}</option> : null}
        {agents.map((agent) => (
          <option key={agent.agentTypeId} value={agent.agentTypeId}>{agent.label}</option>
        ))}
      </select>
    </label>
  )
}
