export type CommandPaletteTouchExemption = {
  selector: string
  name?: string
  rationale: string
}

const NAMED_APP_SHELL_CONTROLS = [
  "Workspace",
  "Attach files",
  "Agent prompt",
  "Submit",
  "Thinking level: Med",
  "Hide workspace menu",
  "Files",
  "Open app navigation",
  "Search",
  "Search⌘K",
  "SearchCtrlK",
  "New chat",
  "New chat in split pane",
  "Quick chat",
  "Inbox",
  "Tasks",
  "Plugins",
  "Skills",
  "Toggle theme",
  "Hide app navigation",
] as const

export const COMMAND_PALETTE_TOUCH_EXEMPTIONS: readonly CommandPaletteTouchExemption[] = [
  {
    selector: '[role="group"][aria-label="Palette mode"] button',
    rationale: "Compact segmented mode control; keyboard and full-width command-input alternatives remain available.",
  },
  {
    selector: "input[cmdk-input]",
    rationale: "The command input keeps a 48px-high touch surface and expands as the compact mode controls allow.",
  },
  {
    selector: 'button[aria-label$="in new chat pane"]',
    rationale: "Compact secondary icon action beside a full-width primary command result; keyboard activation remains available.",
  },
  {
    selector: 'button[aria-label^="Open model picker. Current model:"]',
    rationale: "Named existing app-shell model picker outside the command-palette surface.",
  },
  {
    selector: 'button[title^="Command palette"]',
    rationale: "Full-width app-navigation command-palette trigger; keyboard and top-bar alternatives also remain available.",
  },
  ...NAMED_APP_SHELL_CONTROLS.map((name) => ({
    selector: "button,input,textarea",
    name,
    rationale: `Named existing app-shell control (${name}); outside the command-palette surface and unchanged by this tooling slice.`,
  })),
  {
    selector: 'button[aria-label^="Pin "]',
    rationale: "Compact secondary session-row action beside a full-width primary target.",
  },
  {
    selector: 'button[aria-label^="Delete "]',
    rationale: "Compact secondary session-row action; excluded from the exploration action model.",
  },
]

