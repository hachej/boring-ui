import {
  CoreWorkspaceAgentFront,
  type CoreWorkspaceAgentFrontProps,
} from '@hachej/boring-core/app/front'
import { FULL_APP_AGENT_COMPOSITION } from './plugins'

/** Keeps the hosted full-app shell on the same addressed agent as automation dispatch. */
export function FullAppWorkspaceAgentFront(props: CoreWorkspaceAgentFrontProps) {
  return <CoreWorkspaceAgentFront {...props} {...FULL_APP_AGENT_COMPOSITION} />
}
