// The builder agent of the feedback demo: the AmbientChat bar's agent with the opt-in feedback capability
// (`@hachej/boring-feedback/agent`) over the example's store, plus one small fictional tool, `edit_page`, that changes the fictional
// Fernhill page. By default it runs on a keyless SCRIPTED model, so the demo and its journeys are deterministic and need no
// key. `FEEDBACK_PROVIDER=openai|anthropic` (and the provider's usual key) swaps in a real model; nothing requires one.
//
// What the scripted model does, from the person's last message and the tool results that followed it:
//   - a message with an `@feedback/<id>.md` mention of a report with notes (what the composer's Feedback button sends): `list`, then
//     one reply citing each note with its element and `source` file:line (the list card's element lines highlight on hover);
//   - a message with an `@feedback/<id>.md` mention of a report without notes: `list` (open items), then `show` for that id (an
//     offer), then one sentence;
//   - "check feedback": `list`, then one sentence naming each open item;
//   - "show <id>" (optionally "#<n>" for anchor n): `show`, then one sentence;
//   - "resolve <id>": `read`, then `edit_page` when the report points at the Save button, then `resolve` with the revision it
//     read, then one sentence stating the store's outcome (applied, conflict, unknown...) as it was returned;
//   - "preview" (about the last report mentioned; its notes are the instructions) or "preview: <change>": `browser_preview`, which
//     waits for the person's page (its preview subagent changes the live page, the banner offers Approve / Discard); after Approve the
//     ticket flow below with the approved changes as acceptance criteria; after Discard one sentence and no ticket;
//   - "ticket" (with an id, or about the last report mentioned in the conversation): `load_skill` boring-pm, `feedback read`, then
//     `write` of the boring-pm feature ticket filled from the report (`ticketFromReport`) to `tickets/<id>.md`, `present` of it, and
//     one sentence with the link the host's ticket sink recorded (or its refusal);
//   - anything else: a short hint.
//
// Tickets (FEEDBACK.md, "Tickets"): the builder has the boring-pm skill (a pinned copy in ./skills/boring-pm, loaded on demand with
// `load_skill`) and the standard workspace tools: Pi's read, write and edit behind the file guard, and `present`. A ticket is the file
// `tickets/<id>.md`; the host wraps `write` (tickets.mjs, `ticketsOnWrite`) so a new ticket is mirrored to the project's sink once. The
// skill's text is unchanged; the host instructions below say how it applies here.
// Fictional content only.
import { readFileSync } from 'node:fs';
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { defineAgent, parseSkill } from '@hachej/boring-agent/agents';
import { createPresentTool } from '@hachej/boring-agent/artifacts';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { BROWSER_PREVIEW_TOOL, createBrowserPreviewTool, createFeedbackCapability } from '@hachej/boring-feedback/agent';
import { appElementResolution } from '@hachej/boring-feedback/page';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { readFiles, writeFiles } from '../shared/workspace-tools.mjs';
import { ticketOutcomeOf, ticketsOnWrite } from './tickets.mjs';

export const BUILDER_INSTRUCTIONS = `You are the builder assistant inside "Fernhill Studio", a fictional settings page. Be brief.
People leave feedback by pointing at the page. Use the feedback tool to list, read and offer to show it, and resolve a report only after you changed the page.
To change the page, use edit_page. Never claim you showed or highlighted anything: show is an offer the person accepts in the chat.
When the person asks to see a change first ("preview", "make it green"), call ${BROWSER_PREVIEW_TOOL} with the change in their words and the feedback id: their page previews it live and they approve or discard it. Nothing is saved by a preview. After an approval, write the ticket (boring-pm) with the approved changes as acceptance criteria, each with its element and source file:line, then share the link. After a discard, say so and file nothing.`;

const SKILL_DIRECTORY = new URL('./skills/boring-pm/', import.meta.url);
/** The files SKILL.md links to, appended to its body (unchanged) so `load_skill` returns the whole skill to an agent with no file access. */
const SKILL_FILES = ['tickets.md', 'discovery.md', 'mockups.md', 'onboarding.md', 'templates/contract.md', 'templates/scenario.md', 'templates/mockup.html'];

/** The pinned boring-pm skill (./skills/boring-pm/SOURCE.json): SKILL.md, then each linked file inside `<file path="...">`. */
export function boringPmSkill() {
  const skill = parseSkill(readFileSync(new URL('SKILL.md', SKILL_DIRECTORY), 'utf8'));
  const files = SKILL_FILES.map(path => `<file path="${path}">\n${readFileSync(new URL(path, SKILL_DIRECTORY), 'utf8').trim()}\n</file>`);
  return { ...skill, body: `${skill.body}\n\n${files.join('\n\n')}` };
}

/**
 * The host's instructions about the project and its tickets, appended to the builder's own. The skill was written for a person running
 * `gh` locally; here a ticket is a workspace file the host publishes through its ticket sink.
 */
export function ticketInstructions(project) {
  const repos = project.repos.length ? project.repos.map(item => `${item.repo}${item.role ? ` (${item.role})` : ''}`).join(', ') : 'none (tickets stay as files in this workspace)';
  return `Project: ${project.name}. Repositories: ${repos}.
Tickets: when the person asks for a ticket, call load_skill for boring-pm and follow its ticket conventions (tickets.md: the feature issue's title, labels and body sections). This host has no git or gh: skip the start checks and onboarding, and write the ticket as ONE new markdown file tickets/<feedback id>.md with the write tool. Its content starts with front matter of JSON values: title, labels, feedback (the report id) and route; never write a "ticket" field. Use only what the report says (its notes in order, each element with its source file:line, the route template) and end with an "### Acceptance criteria" section drawn from the notes (after an approved ${BROWSER_PREVIEW_TOOL}, also one criterion per approved change: the element with its source file:line, the property or text, from and to). The host then publishes the ticket to the project's tracker, records the outcome in its front matter as ticket: {"sink","url"} or {"sink","refused"} and adds it to the write result as a "Ticket:" line. Then call present with the ticket's path and give the person that link to review, or the refusal. Never invent a link.`;
}

/** The new label the builder gives the Save button when a report points at it. */
export const SAVE_LABEL_AFTER = 'Save studio profile';
const ID = /\bfb_[1-9A-HJ-NP-Za-km-z]{16}\b/;
const MENTION = /@feedback\/(fb_[1-9A-HJ-NP-Za-km-z]{16})\.md/;

const MODEL = { id: 'fernhill-builder-script', name: 'Fictional scripted builder', provider: 'fernhill-script', api: 'fernhill-script-api', baseUrl: 'https://fixture.invalid',
  input: ['text'], reasoning: false, contextWindow: 65536, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const textOf = message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
const resultOf = message => { try { return JSON.parse(textOf(message)); } catch { return { kind: 'unreadable', text: textOf(message) }; } };
const said = value => typeof value === 'string' ? value : '';
const circled = number => number >= 1 && number <= 20 ? String.fromCodePoint(0x245f + number) : String(number);

/** The report the mention resolver inlined for `id` in the person's message (a `<file path="feedback/<id>.md">` part), parsed. */
function inlinedReport(message, id) {
  const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  const head = `<file path="feedback/${id}.md">\n`;
  const part = parts.find(item => item.type === 'text' && item.text.startsWith(head));
  if (!part) return undefined;
  const text = part.text.slice(head.length, part.text.lastIndexOf('\n</file>')).replace(/<\\\/file>/g, '</file>');
  const parsed = parseFeedback(new TextEncoder().encode(text));
  return parsed.ok ? parsed.report : undefined;
}

const oneLine = text => text.replace(/\s+/g, ' ').trim();
const clip = (text, max) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * The boring-pm feature ticket for a feedback report (tickets.md, "File a feature": `[besoin]` title, `kind:feature` and `by:pm-agent`
 * labels, the four form sections), plus the report's timeline, its elements with file:line, its route template and acceptance criteria
 * drawn from the notes. Only the stored (masked) report is used: notes, element fallbacks, `source` locations, steps and the route; no
 * author, transcript or page snapshot. `preview` is an approved `browser_preview` answer: its summary goes in "Approved preview" and
 * each change becomes an acceptance criterion with its element and source file:line. Returns `{ title, markdown }`.
 */
export function ticketFromReport(report, preview) {
  const route = report.observed?.kind === 'host' ? report.observed.subject.route : undefined;
  // The element as the fallback names it, with its full `source` path in place of the fallback's short `(file:line)`.
  const labelOf = anchor => anchor.signals?.source ? `${anchor.fallback.replace(/ \([^()]*:\d+\)$/, '')} (\`${anchor.signals.source}\`)` : anchor.fallback;
  const notes = [...(report.notes ?? [])];
  if (report.said.trim()) notes.push({ text: report.said });
  const elementOf = note => {
    const anchor = note.anchor === undefined ? undefined : report.anchors[note.anchor];
    return anchor ? labelOf(anchor) : 'the page in general';
  };
  const quoted = note => `"${oneLine(note.text)}"`;
  const title = `[besoin] ${clip(oneLine(notes[0]?.text ?? 'Feedback on the page'), 80)}`;
  const where = route ? `\`${route}\`` : 'the page';
  const timeline = report.steps?.length
    ? report.steps.map(step => step.kind === 'note' ? `${circled(step.note + 1)} Note on ${elementOf(report.notes[step.note])}: ${quoted(report.notes[step.note])}${report.notes[step.note].from === 'voice' ? ' (said aloud)' : ''}`
      : step.kind === 'route' ? `Went to \`${step.route}\`` : step.kind === 'click' ? `Clicked ${step.target}` : `Pressed ${step.key}${step.target ? ` on ${step.target}` : ''}`)
    : notes.map((note, index) => `${circled(index + 1)} Note on ${elementOf(note)}: ${quoted(note)}`);
  const elements = [...new Set(report.anchors.map(anchor => `- ${labelOf(anchor)}${anchor.signals?.source ? '' : ': source not recorded'}`))];
  const changed = preview?.kind === 'approved' ? preview.changes : [];
  const changeLabel = change => change.source ? `${change.element.replace(/ \([^()]*:\d+\)$/, '')} (\`${change.source}\`)` : change.element;
  const criteria = [
    ...notes.map(note => `on ${where}, ${elementOf(note)}: ${oneLine(note.text)}`),
    ...changed.map(change => `on ${where}, ${changeLabel(change)}: ${change.text ? `the text reads "${oneLine(change.to)}" (was "${oneLine(change.from)}")` : `${change.property} is \`${change.to}\` (was \`${change.from}\`)`}, as previewed and approved`),
  ];
  const approved = changed.length ? `### Approved preview

${oneLine(preview.summary)} Previewed live on the page and approved by the person; nothing was changed in the code yet.

${changed.map(change => `- ${changeLabel(change)}: ${change.text ? 'text' : change.property} \`${change.from}\` → \`${change.to}\``).join('\n')}

` : '';
  const front = { title, labels: ['kind:feature', 'by:pm-agent'], feedback: report.id, ...(route ? { route } : {}) };
  const markdown = `---
${Object.entries(front).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}
---

### Ce qui deviendrait plus simple

${notes.map(note => `- ${oneLine(note.text)}`).join('\n') || '- (no note)'}

### Comment vous faites aujourd'hui

On ${where} today: ${[...new Set(notes.map(elementOf))].join('; ')}, as they are now.

### Exemples concrets (fictifs)

Feedback ${report.id}, in the order it was left:

${timeline.map((line, index) => `${index + 1}. ${line}`).join('\n')}

### Ce qui ne doit surtout pas changer

Everything on ${where} that these notes do not mention.

### Elements

${elements.join('\n') || '- (none pinned)'}

Route: ${where}

${approved}### Acceptance criteria

${criteria.map((criterion, index) => `- [ ] AC-${index + 1}: ${criterion}`).join('\n')}
`;
  return { title, markdown };
}

/** The id of the last report mentioned in the person's messages before `before`, for "create a ticket" with no id. */
function lastReport(messages, before) {
  for (let at = before; at >= 0; at--) {
    if (messages[at].role !== 'user') continue;
    const text = typeof messages[at].content === 'string' ? messages[at].content : messages[at].content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    const found = MENTION.exec(text)?.[1] ?? ID.exec(text)?.[0];
    if (found) return found;
  }
  return undefined;
}

/** The notes (and general remark) of report `id`, from the person's message that inlined it, joined for a preview instruction. */
function notesOf(messages, id, before) {
  for (let at = before; at >= 0; at--) {
    if (messages[at].role !== 'user') continue;
    const report = inlinedReport(messages[at], id);
    if (report) return [...(report.notes ?? []).map(note => oneLine(note.text)), ...(report.said.trim() ? [oneLine(report.said)] : [])].join('; ');
  }
  return '';
}

/** The ticket's file: `tickets/<id>.md`, then `tickets/<id>-2.md`... for later tickets about the same report in this conversation. */
function ticketPath(id, messages) {
  let last = messages.length - 1;
  while (last >= 0 && messages[last].role !== 'user') last--;
  const earlier = messages.slice(0, last).filter(message => message.role === 'assistant' && Array.isArray(message.content))
    .flatMap(message => message.content).filter(part => part.type === 'toolCall' && part.name === 'write' && String(part.arguments?.path ?? '').startsWith(`tickets/${id}`)).length;
  return earlier ? `tickets/${id}-${earlier + 1}.md` : `tickets/${id}.md`;
}

/** The scripted ticket flow: load_skill boring-pm → feedback read → write tickets/<id>.md → present → the link (or refusal). */
function ticketStep(id, results, preview, messages) {
  const result = name => results.find(item => item.name === name)?.value;
  if (!results.some(item => item.name === 'load_skill')) return { tool: 'load_skill', args: { name: 'boring-pm' } };
  const read = results.find(item => item.name === 'feedback' && item.value.action === 'read')?.value;
  if (!read) return { tool: 'feedback', args: { action: 'read', id } };
  if (read.kind !== 'available') return { text: `I cannot write a ticket for ${id}: read returned ${read.kind}${read.reason ? ` (${read.reason})` : ''}.` };
  const path = ticketPath(id, messages);
  const written = result('write');
  if (!written) {
    const parsed = parseFeedback(new TextEncoder().encode(read.report));
    if (!parsed.ok) return { text: `I cannot write a ticket for ${id}: the report does not parse.` };
    return { tool: 'write', args: { path, content: ticketFromReport(parsed.report, preview).markdown } };
  }
  const outcome = ticketOutcomeOf(written.text ?? '');
  if (!outcome) return { text: `The ticket for ${id} was not written: ${oneLine(written.text ?? written.kind ?? 'no result')}` };
  if (!results.some(item => item.name === 'present')) return { tool: 'present', args: { path } };
  if ('url' in outcome) return { text: `${preview ? `Approved preview: ${preview.summary} ` : ''}Ticket for ${id} filed (${outcome.sink}): ${outcome.url} Please review it.` };
  if ('refused' in outcome) return { text: `The ticket ${path} for ${id} is written here but was not published${outcome.sink ? ` to ${outcome.sink}` : ''}: ${outcome.refused}` };
  return { text: `The ticket ${path} for ${id} is written; publishing it to ${outcome.sink} has no known outcome yet: check ${outcome.sink} before filing again.` };
}

/**
 * The scripted turn: what the model does next, from the transcript. Pure, so the decision is a function of the transcript.
 * Returns `{ tool, args }` or `{ text }`.
 */
export function scriptedStep(messages) {
  let last = -1;
  for (let at = messages.length - 1; at >= 0; at--) if (messages[at].role === 'user') { last = at; break; }
  if (last < 0) return { text: 'Hello. Say "check feedback", mention a report with @, or "resolve fb_…".' };
  const typed = typeof messages[last].content === 'string' ? messages[last].content : said(messages[last].content.find(part => part.type === 'text')?.text);
  const results = messages.slice(last + 1).filter(message => message.role === 'toolResult').map(message => ({ name: message.toolName, value: resultOf(message) }));
  const after = name => results.find(result => result.name === 'feedback' && result.value.action === name)?.value;
  const done = results.length;

  if (/^\s*preview\b/i.test(typed)) {
    const id = ID.exec(typed)?.[0] ?? lastReport(messages, last);
    const asked = /^\s*preview\s*:\s*([\s\S]+)$/i.exec(typed)?.[1]?.trim();
    const instructions = asked || (id ? notesOf(messages, id, last) : '');
    const preview = results.find(result => result.name === BROWSER_PREVIEW_TOOL);
    if (!preview) {
      if (!instructions) return { text: 'What should I preview? Say "preview: make the Save button green", or leave feedback first.' };
      return { tool: BROWSER_PREVIEW_TOOL, args: { instructions: clip(instructions, 2000), ...(id ? { feedback: id } : {}) } };
    }
    if (preview.value.kind === 'discarded') return { text: 'Preview discarded: the page is back as it was, and nothing was filed.' };
    if (preview.value.kind !== 'approved') return { text: 'The preview did not finish (the page did not answer, or it was stopped). Nothing was filed.' };
    if (!id) return { text: `Approved: ${preview.value.summary} Leave feedback on the element to file it as a ticket.` };
    return ticketStep(id, results, preview.value, messages);
  }

  if (/\btickets?\b/i.test(typed)) {
    const id = ID.exec(typed)?.[0] ?? lastReport(messages, last);
    return id ? ticketStep(id, results, undefined, messages) : { text: 'Which feedback should the ticket be about? Mention a report with @ or say "ticket fb_…".' };
  }

  const mentioned = MENTION.exec(typed)?.[1];
  const inlined = mentioned ? inlinedReport(messages[last], mentioned) : undefined;
  if (mentioned && inlined?.notes?.length) {
    if (done === 0) return { tool: 'feedback', args: { action: 'list', status: 'open' } };
    const listed = after('list');
    const item = listed?.kind === 'available' ? listed.items.find(entry => entry.id === mentioned) : undefined;
    const lines = inlined.notes.map((note, index) => {
      const anchor = note.anchor === undefined ? undefined : item?.anchors?.[note.anchor];
      const where = anchor ? `${anchor.fallback}${anchor.signals?.source ? ` (${anchor.signals.source})` : ''}` : 'the page in general';
      return `${circled(index + 1)} ${where}: "${note.text.split('\n')[0]}"${note.from === 'voice' ? ' (said aloud)' : ''}`;
    });
    if (inlined.said.trim()) lines.push(`General: "${inlined.said.split('\n')[0]}"`);
    const steps = inlined.steps?.filter(step => step.kind !== 'note').length ?? 0;
    return { text: `${mentioned}: ${inlined.notes.length} note${inlined.notes.length === 1 ? '' : 's'}${steps ? `, ${steps} steps in between` : ''}. ${lines.join(' ')} Hover an element line in the card to see it on the page.` };
  }
  if (mentioned) {
    if (done === 0) return { tool: 'feedback', args: { action: 'list', status: 'open' } };
    const listed = after('list');
    const item = listed?.kind === 'available' ? listed.items.find(entry => entry.id === mentioned) : undefined;
    if (done === 1) return { tool: 'feedback', args: { action: 'show', id: mentioned, ...(item ? { note: item.title } : {}) } };
    const offer = after('show');
    if (offer?.kind !== 'offered') return { text: `I cannot offer to show ${mentioned}: ${offer?.kind ?? 'no result'}${offer?.reason ? ` (${offer.reason})` : ''}.` };
    const source = item?.anchors?.[offer.anchor]?.signals?.source;
    return { text: `${mentioned}: "${item?.title ?? 'feedback'}"${item ? ` from ${item.author}` : ''}. It points at ${offer.fallback}${source ? ` (source ${source})` : ''}. I offered to show ${mentioned}: press Show in the card to see it on the page.` };
  }

  const resolving = /\bresolve\b/i.test(typed) ? ID.exec(typed)?.[0] : undefined;
  if (resolving) {
    if (done === 0) return { tool: 'feedback', args: { action: 'read', id: resolving } };
    const read = after('read');
    if (read?.kind !== 'available') return { text: `I cannot resolve ${resolving}: read returned ${read?.kind ?? 'nothing'}${read?.reason ? ` (${read.reason})` : ''}.` };
    const pointsAtSave = read.report.includes('save-profile');
    const note = pointsAtSave ? `Renamed the Save button to «${SAVE_LABEL_AFTER}» so it says what it saves.` : 'Reviewed on the page; no change was needed.';
    const edited = results.some(result => result.name === 'edit_page');
    if (pointsAtSave && !edited) return { tool: 'edit_page', args: { target: 'save-profile', label: SAVE_LABEL_AFTER } };
    const resolved = after('resolve');
    if (!resolved) return { tool: 'feedback', args: { action: 'resolve', id: resolving, expectedRevision: read.revision, note } };
    if (resolved.kind === 'applied') return { text: `Resolved ${resolving}: ${resolved.status}. ${note}` };
    if (resolved.kind === 'conflict') return { text: `Conflict on ${resolving}: it changed since I read it (${resolved.reason}). Nothing was written; read it again before resolving.` };
    return { text: `Not resolved ${resolving}: ${resolved.kind}${resolved.reason ? ` (${resolved.reason})` : ''}.` };
  }

  const showing = /\bshow\b/i.test(typed) ? ID.exec(typed)?.[0] : undefined;
  if (showing) {
    const anchor = /#(\d+)/.exec(typed);
    if (done === 0) return { tool: 'feedback', args: { action: 'show', id: showing, ...(anchor ? { anchor: Number(anchor[1]) } : {}) } };
    const offer = after('show');
    return offer?.kind === 'offered'
      ? { text: `I offered to show ${showing} (${offer.fallback}): press Show in the card.` }
      : { text: `I cannot offer to show ${showing}: ${offer?.kind ?? 'no result'}${offer?.reason ? ` (${offer.reason})` : ''}.` };
  }

  if (/\b(check|list)\b.*\bfeedback\b/i.test(typed)) {
    if (done === 0) return { tool: 'feedback', args: { action: 'list', status: 'open' } };
    const listed = after('list');
    if (listed?.kind !== 'available') return { text: `I cannot list feedback: ${listed?.kind ?? 'no result'}${listed?.reason ? ` (${listed.reason})` : ''}.` };
    if (!listed.items.length) return { text: 'No open feedback that you can see.' };
    return { text: `${listed.items.length} open: ${listed.items.map(item => `${item.id} "${item.title}"`).join('; ')}.` };
  }
  return { text: 'Say "check feedback", mention a report with @, "show fb_…", "resolve fb_…", "preview" or "create a ticket".' };
}

/** The keyless scripted model as a native provider. Tool call ids are unique per process. */
export function scriptedBuilderModels() {
  let calls = 0;
  const stream = (_model, transcript) => {
    const step = scriptedStep(transcript.messages);
    const content = step.tool ? [{ type: 'toolCall', id: `fh_call_${++calls}`, name: step.tool, arguments: step.args }] : [{ type: 'text', text: step.text }];
    const message = { role: 'assistant', content, api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: Date.now(), stopReason: step.tool ? 'toolUse' : 'stop', usage: USAGE };
    const events = createAssistantMessageEventStream();
    events.push({ type: 'start', partial: message });
    events.push({ type: 'done', reason: message.stopReason, message });
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider: MODEL.provider, modelId: MODEL.id } };
}

async function realModels(provider) {
  const load = {
    openai: async () => (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider(),
    anthropic: async () => (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider(),
  }[provider];
  if (!load) throw new Error(`FEEDBACK_PROVIDER must be openai or anthropic, not ${provider}`);
  const models = createModels();
  models.setProvider(await load());
  return { models, model: { provider, modelId: process.env.FEEDBACK_MODEL ?? (provider === 'openai' ? 'gpt-5-mini' : 'claude-sonnet-4-5') } };
}

/**
 * The `agent` seam of `startFeedbackApp`: `({ store, people, accessOf, page, tickets, project }) => ({ definition, models })`.
 * `accessOf(conversationId)` is the host's access for the person whose conversation called the tool; the builder acts as its own principal
 * on their behalf. `tickets` is `{ sinks, files, root }` (the `createTicketSinks` result, the workspace provider and the workspace root)
 * and `project` the `{ name, repos }` the instructions name; without `tickets` the builder has no file tools and no skill.
 */
export async function builderAgent({ store, accessOf, page, tickets, project = { name: 'Fernhill Studio', repos: [] }, provider = process.env.FEEDBACK_PROVIDER }) {
  const feedback = createFeedbackCapability({
    store, resolutions: { [appElementResolution.kind]: appElementResolution }, operationNamespace: 'fernhill-builder-v1',
    resolveAccess: api => accessOf(api.conversationId),
  });
  const editPage = defineTool({
    name: 'edit_page', description: 'Change the fictional Fernhill page. target "save-profile": the Save button of the profile form, with its new label.',
    parameters: Type.Object({ target: Type.Literal('save-profile'), label: Type.String({ minLength: 1, maxLength: 60 }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async args => ({ content: [{ type: 'text', text: JSON.stringify({ kind: 'applied', page: page.edit(args) }) }] }),
  });
  const { models, model } = provider ? await realModels(provider) : scriptedBuilderModels();
  // Tickets: the standard workspace tools (Pi's read, write and edit, then the file guard, then the ticket trigger on write) and present.
  const resolveAccess = api => accessOf(api.conversationId);
  const workspace = tickets ? {
    tools: [createPresentTool({ workspace: { files: tickets.files, root: tickets.root }, resolveAccess })],
    extensions: [readFiles, writeFiles, createFileGuard({ workspace: { files: tickets.files, root: tickets.root }, resolveAccess }), ticketsOnWrite({ tickets: tickets.sinks, files: tickets.files, root: tickets.root, resolveAccess })],
  } : { tools: [], extensions: [] };
  const definition = defineAgent({ id: 'fernhill-builder', model, instructions: tickets ? `${BUILDER_INSTRUCTIONS}\n${ticketInstructions(project)}` : BUILDER_INSTRUCTIONS,
    tools: [editPage, createBrowserPreviewTool(), ...workspace.tools], ...(tickets ? { skills: [boringPmSkill()] } : {}), extensions: [feedback.extension, ...workspace.extensions], ...(tickets ? { cwd: tickets.root } : {}) });
  return { definition, models };
}
