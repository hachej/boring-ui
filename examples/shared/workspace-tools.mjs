// Workspace tools of the standard agent: Pi's native read, write, edit and bash, plus a directory listing, all through the
// call's ExecutionEnv. Which environment that is (an in-memory just-bash workspace, a Vercel Sandbox, ...) is the variant's
// business; nothing here knows. Split in three so an agent selects only what it may use, and the read-only part can be
// handed to subagents. No Node-only imports.
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { createBashTool, createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { Type } from '@earendil-works/pi-ai';

const listFiles = defineTool({
  name: 'list_files', description: 'List one workspace directory (default: the workspace root).',
  parameters: Type.Object({ path: Type.Optional(Type.String()) }, { additionalProperties: false }), replay: 'safe',
  execute: async (args, api, context) => {
    const entries = getOrThrow(await api.env.listDir(args.path ?? '.', context));
    return { content: [{ type: 'text', text: entries.map(entry => `${entry.kind === 'directory' ? 'dir ' : 'file'} ${entry.name}`).join('\n') || '(empty)' }] };
  },
});

/** read and list_files: also what a subagent gets. */
export const readFiles = defineExtension({ name: 'studio.files.read', tools: [createReadTool(), listFiles] });
/** write and edit. */
export const writeFiles = defineExtension({ name: 'studio.files.write', tools: [createWriteTool(), createEditTool()] });
/** bash, for variants that have a shell. */
export const shell = defineExtension({ name: 'studio.shell', tools: [createBashTool()] });
