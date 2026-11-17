import { SlashPicker } from '../../registry/pi-chat-slash/slash-menu.tsx';

// The demo's `/` menu (the design-system page and the ambient bar): three commands, three skills and three actions, all invented.
// The `/` menu. The app's provider is one list (`id`, `kind`, `label`, `description`, `argumentHint`); the kit takes it as `slash.commands`, `slash.skills` and `slash.actions`.
// A command acts on the page, a skill is text for the assistant (`/summarize <file>`), an action asks the assistant to do something for the person.
export function demoSlash({ controller, reset }) {
  const ask = text => controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
  const PROVIDER = [
    { id: 'clear', kind: 'command', label: 'clear', description: 'Start a fresh conversation', run: () => reset() },
    { id: 'help', kind: 'command', label: 'help', description: 'Ask what the assistant can do', run: api => api.setText('What can you do here?') },
    { id: 'shortcuts', kind: 'command', label: 'shortcuts', description: 'List the keyboard shortcuts', run: api => api.setText('Which keyboard shortcuts are there?') },
    { id: 'summarize', kind: 'skill', label: 'summarize', description: 'Summarize a table in a few lines', argumentHint: '<file>' },
    { id: 'draft-reminder', kind: 'skill', label: 'draft-reminder', description: 'Write a polite payment reminder', argumentHint: '<customer>' },
    { id: 'review-entries', kind: 'skill', label: 'review-entries', description: 'Look for errors in the entries' },
    { id: 'export-gaps', kind: 'action', label: 'export-gaps', description: 'Save the open gaps as a CSV file', run: () => ask('Export the open gaps') },
    { id: 'archive-draft', kind: 'action', label: 'archive-draft', description: 'Move the old draft to the archive', run: () => ask('Archive the old draft') },
    { id: 'new-entry', kind: 'action', label: 'new-entry', description: 'Add an entry to the journal', argumentHint: '<amount>', run: api => api.setText(`New entry ${api.text}`.trim()) },
  ];
  const toSlash = list => ({ Picker: SlashPicker, ...Object.fromEntries([['commands', 'command'], ['skills', 'skill'], ['actions', 'action']].map(([key, kind]) => [key,
    list.filter(item => item.kind === kind).map(({ label, description, argumentHint, run }) => ({ name: label, description, ...(argumentHint ? { argumentHint } : {}), ...(run ? { run } : {}) }))])) });
  return toSlash(PROVIDER);
}
