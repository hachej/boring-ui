export const AUTOMATION_PROMPT_DIRECTORY = ".agents/automation"

export function automationPromptPath(automationId: string): string {
  return `${AUTOMATION_PROMPT_DIRECTORY}/${automationId}.md`
}
