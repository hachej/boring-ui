// Helpers for scenario scripts (not a scenario: files starting with `_` are skipped by the loader). A script is the scripted model's side of a
// scenario; the format is documented in packages/testing/README.md (@hachej/boring-testing/model). Shared turn lists are exported once so scenarios that begin with the same
// prompt (the trail report, the shared document) answer it with the very same turns.

/** One tool call as a turn; `extra` adds text, reasoning or a delay. */
export const call = (name, args, extra = {}) => ({ ...extra, tools: [{ name, args }] });
/** Several tool calls in one turn, in order. */
export const calls = (...list) => ({ tools: list.map(([name, args]) => ({ name, args })) });
/** Text streamed one chunk at a time (abortable), so Stop and queueing have a running answer to act on. */
export const slow = (chunks, ms) => ({ text: { chunks, ms } });
/** A paragraph-sized answer streamed over about `seconds`, ending with `ending` on its own line. */
export const story = (seconds, ending) => slow([...Array.from({ length: Math.round(seconds * 2) }, (_, at) => `Line ${at + 1} of a fictional story about harbour lights. `), ending], 500);

/** The newest artifact the model presented in this transcript. */
export const latestArtifact = ctx => ctx.history.map(result => result.json?.artifact).filter(Boolean).at(-1);

export const REPORT = `# Mount Placeholder loop

A fictional trail report for an invented circuit that starts and ends at Placeholder Pier.

## Route

Follow the cliff path to Example Cove, climb the stepped ridge, then return along the old tram line. The loop is about nine kilometres.

## Conditions

The path is dry and well marked. Expect a light breeze on the ridge and fog in the early morning.

## Timing

Allow three hours at an easy pace, plus a break at the Invented Inn.
`;
export const SAFETY = `## Safety notes

- Carry a whistle and a charged phone.
- Turn back if the fog covers the ridge.
`;

/** A file written with the ordinary file tool and then presented: the two calls of an artifact. */
export const writeAndPresent = (path, content) => [call('write', { path, content }), call('present', { path })];
/** Read the file again (the person may have edited it), add `text` after the line `after` with the ordinary edit tool, and present it again. */
export const reviseAndPresent = (path, after, text) => [call('read', { path }), call('edit', { path, edits: [{ oldText: after, newText: `${after}\n\n${text.trim()}` }] }), call('present', { path })];

export const REPORT_PATH = 'reports/mount-placeholder-loop.md';
/** REPORT_PROMPT: write the trail report and present it. The workspace may already hold the file (another scenario wrote it): read first, as the guard requires for a file that exists. */
export const REPORT_TURNS = [call('read', { path: REPORT_PATH }), ...writeAndPresent(REPORT_PATH, REPORT), 'The trail report is ready.'];
/** REVISE_PROMPT: read the report (the person may have edited it), add the new section and present it again. */
export const REVISE_TURNS = [...reviseAndPresent(REPORT_PATH, 'plus a break at the Invented Inn.', SAFETY), 'Added the safety notes.'];

/** The shared document is the workspace file notes.md. */
export const NOTES_PATH = 'notes.md';
export const NOTES_PROMPT = 'Write the shared document notes.md (read it first if it exists, then create or replace it): a packing list titled "Moon picnic" with exactly three bullet items. Then show it with present.';
/** Read what is there (an error when nothing is saved yet), write the document and present it. */
export const SAVE_NOTES_TURNS = [
  call('read', { path: NOTES_PATH }),
  call('write', { path: NOTES_PATH, content: '# Moon picnic\n\n- Blanket\n- Thermos\n- Lantern\n' }),
  call('present', { path: NOTES_PATH }),
  'The packing list is saved.',
];
