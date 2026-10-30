// @hachej/boring-agent/struggle: an app's agent reports its own failures (fleet standard S6), so the fleet can fix them without a person
// noticing. `defineAgent` selects this extension by default. It reads run events through native hooks and sends only kinds, tool names and
// ids to the host's sink: the person's words are read to classify them and never leave this module.
import { createHash } from 'node:crypto';
import { GenerationTask, ToolTask, defineExtension, hook } from '@earendil-works/pi-durable';
import type { Extension } from '@earendil-works/pi-durable';
import type { Message } from '@earendil-works/pi-ai';
import { jsonSchemaTool } from './json-schema-tool.js';

export const REPORT_BUG_TOOL = 'report_bug';

/**
 * `tool_error`: a tool answered with an error. `tool_retry`: since the person's last message, one tool ran 3 times with the same arguments,
 * or failed 3 times. `rephrase`: the message shares at least 75% of its words with one of the person's 2 previous messages (3 words or more).
 * `correction`: the message opens by saying the agent is wrong; a bare « non » answering a question does not count. `abandoned`: the person
 * stopped a run mid-task, seen when the attempt ends or at the next request. `report_bug`: the agent called the tool.
 */
export type StruggleKind = 'tool_error' | 'tool_retry' | 'rephrase' | 'correction' | 'abandoned' | 'report_bug';

export const BUG_CATEGORIES = ['tool_failed', 'impossible', 'person_says_wrong'] as const;
export type BugCategory = (typeof BUG_CATEGORIES)[number];

/** Content-free: never the person's words, and no text a model wrote unless the host turned on `agentText`. */
export interface AgentStruggle {
  readonly event: 'agent.struggle';
  readonly kind: StruggleKind;
  readonly agent: string;
  /** Stable for one agent, kind and tool: the host files one task per fingerprint. */
  readonly fingerprint: string;
  readonly conversationId: number;
  readonly taskId: number;
  readonly tool?: string;
  /** On `report_bug`: which of `BUG_CATEGORIES` the agent chose. */
  readonly category?: BugCategory;
  /** Never set here: a host that knows the request adds it in its sink. */
  readonly req_id?: string;
  /** With `agentText` only. */
  readonly summary?: string;
  readonly tried?: string;
}
export type StruggleSink = (struggle: AgentStruggle) => void | Promise<void>;

/** Without a host sink an event is one structured log line, so nothing is lost before a host wires one. */
const logLine: StruggleSink = struggle => { console.log(JSON.stringify({ level: 'warn', ...struggle })); };
let hostSink: StruggleSink | undefined;
/**
 * The host's sink for every agent of this process that names none: the agent home calls it once, so apps write no code. One sink per
 * process: a process serving several tenants gives each agent its own through `defineAgent({ struggle: { sink } })`.
 */
export function setStruggleSink(sink: StruggleSink | undefined): void { hostSink = sink; }

const MAX_TEXT = 200, MAX_SEEN = 500, SINK_TIMEOUT_MS = 2000;
const scrub = (text: string): string => text.replace(/\S+@\S+/g, '[email]').replace(/\d[\d\s.-]{2,}\d/g, '[number]').slice(0, MAX_TEXT);
const userText = (message: Message): string => message.role !== 'user' ? '' : typeof message.content === 'string' ? message.content
  : message.content.map(part => part.type === 'text' ? part.text : '').join(' ');
const asked = (message: Message | undefined): boolean => message?.role === 'assistant'
  && message.content.map(part => part.type === 'text' ? part.text : '').join('').trim().endsWith('?');
/** The person's words only: the block a point-and-speak message or a mention adds is not what they said. */
const words = (text: string): Set<string> => new Set(text.replace(/^<target>.*?<\/target>/s, '').replace(/<file[\s\S]*?<\/file>/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
function rephrased(text: string, earlier: readonly string[]): boolean {
  const said = words(text);
  if (said.size < 3) return false;
  return earlier.some(other => {
    const before = words(other);
    const shared = [...said].filter(word => before.has(word)).length;
    return shared / new Set([...said, ...before]).size >= 0.75;
  });
}
const WRONG = /^\s*((no|non)[,.! ]+)?(c['’]est faux|c['’]est pas (ça|ca)|ce n['’]est pas (ça|ca)|tu te trompes|vous vous trompez|faux\b|that['’]s wrong|you['’]re wrong|wrong\b|incorrect\b|not what i asked)/i;
const BARE_NO = /^\s*(no|non)\s*[.!]*\s*$/i;

export interface StruggleOptions {
  /** The agent's id, in the fingerprint. */
  readonly agent: string;
  /** Default: the sink of `setStruggleSink`, else one log line. A throw is ignored: reporting never fails the agent. */
  readonly sink?: StruggleSink;
  /** How long the agent waits for the sink, in milliseconds. Default 2000; a late sink keeps running unwatched. */
  readonly sinkTimeoutMs?: number;
  /**
   * Let `report_bug` ask for the agent's own `summary` and `tried`, scrubbed of emails and long numbers. Off by default: free text a model
   * writes can carry a name or a diagnosis no scrub catches, so turn it on only where such text may reach the sink.
   */
  readonly agentText?: boolean;
  /** False when the agent already has a tool named `report_bug`. Default true. */
  readonly tool?: boolean;
  /** Default `agent.<agent>.struggle`. */
  readonly name?: string;
}

/** The S6 extension: the `report_bug` tool and the automatic events. It changes no result and no request. */
export function createStruggleExtension(options: StruggleOptions): Extension {
  const seen = new Set<string>();
  const emit = async (once: string, ids: { readonly conversationId: unknown; readonly taskId: unknown }, kind: StruggleKind, fields: Pick<AgentStruggle, 'tool' | 'category' | 'summary' | 'tried'> = {}): Promise<void> => {
    const key = `${String(ids.conversationId)}:${once}`;
    if (seen.has(key)) return;
    if (seen.size >= MAX_SEEN) seen.delete(seen.values().next().value!);
    seen.add(key);
    const fingerprint = createHash('sha256').update(JSON.stringify([options.agent, kind, fields.tool ?? null])).digest('hex').slice(0, 16);
    // Hooks run before the result commits: a sink that hangs must not hold the agent.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (options.sink ?? hostSink ?? logLine)({ event: 'agent.struggle', kind, agent: options.agent, fingerprint, conversationId: Number(ids.conversationId), taskId: Number(ids.taskId), ...fields }),
        new Promise<void>(resolve => { timer = setTimeout(resolve, options.sinkTimeoutMs ?? SINK_TIMEOUT_MS); }),
      ]);
    } catch { /* the host's sink owns its failures */ } finally { clearTimeout(timer); }
  };
  const tool = jsonSchemaTool<{ category: BugCategory; tool?: string; summary?: string; tried?: string }>({
    name: REPORT_BUG_TOOL,
    description: "Tell the app's team that something is broken: a tool failed, something you should be able to do is impossible, or the person says you are wrong.",
    parameters: { type: 'object', properties: {
      category: { type: 'string', enum: BUG_CATEGORIES },
      tool: { type: 'string', description: 'The name of the tool involved, if any.' },
      ...(options.agentText ? {
        summary: { type: 'string', description: "What is broken, in one short general sentence: never the person's words, name, health, money or any personal value." },
        tried: { type: 'string', description: 'What you tried, in general terms, with no personal value.' },
      } : {}),
    }, required: ['category'] },
    execute: async (args, api, context) => {
      // The model writes these: only a tool the agent really has, and an enum, may leave. A name it made up could carry anything.
      const known = (await api.agent(context)).extensions.some(extension => extension.tools?.some(each => each.name === args.tool));
      await emit(`bug:${api.callId}`, api, 'report_bug', {
        ...(BUG_CATEGORIES.includes(args.category) ? { category: args.category } : {}),
        ...(args.tool && known ? { tool: args.tool } : {}),
        ...(options.agentText && args.summary ? { summary: scrub(args.summary) } : {}),
        ...(options.agentText && args.tried ? { tried: scrub(args.tried) } : {}),
      });
      return { output: [{ type: 'text', text: 'Reported to the team. Carry on with the person.' }] };
    },
  });
  return defineExtension({
    name: options.name ?? `agent.${options.agent}.struggle`,
    tools: options.tool === false ? [] : [tool],
    hooks: [
      hook(ToolTask, {
        afterTool: async (call, result, api) => {
          if (result.isError === true && call.name !== REPORT_BUG_TOOL) await emit(`error:${call.id}`, api, 'tool_error', { tool: call.name });
          return undefined;
        },
      }),
      hook(GenerationTask, {
        afterResponse: async (message, api) => { if (message.stopReason === 'aborted') await emit(`stop:${String(api.taskId)}`, api, 'abandoned'); },
        beforeRequest: async ({ messages }, api) => {
          const users = messages.flatMap((message, index) => message.role === 'user' ? [index] : []);
          const last = users.at(-1);
          if (last === undefined) return undefined;
          if (last === messages.length - 1) {
            const text = userText(messages[last]!);
            const previous = messages[last - 1];
            if (WRONG.test(text) || (BARE_NO.test(text) && !asked(previous))) await emit(`wrong:${last}`, api, 'correction');
            if (rephrased(text, users.slice(-3, -1).map(index => userText(messages[index]!)))) await emit(`rephrase:${last}`, api, 'rephrase');
            if (previous?.role === 'assistant' && previous.stopReason === 'aborted') await emit(`stopped:${last}`, api, 'abandoned');
            return undefined;
          }
          const same = new Map<string, number>(), failed = new Map<string, number>();
          const bump = (counts: Map<string, number>, key: string) => { const count = (counts.get(key) ?? 0) + 1; counts.set(key, count); return count; };
          for (const message of messages.slice(last + 1)) {
            if (message.role === 'assistant') {
              for (const part of message.content) if (part.type === 'toolCall' && bump(same, JSON.stringify([part.name, part.arguments])) === 3) await emit(`retry:${last}:${part.name}`, api, 'tool_retry', { tool: part.name });
            } else if (message.role === 'toolResult' && message.isError && bump(failed, message.toolName) === 3) await emit(`retry:${last}:${message.toolName}`, api, 'tool_retry', { tool: message.toolName });
          }
          return undefined;
        },
      }),
    ],
  });
}
