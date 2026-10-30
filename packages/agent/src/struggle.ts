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
 * or failed 3 times. `rephrase`: the message shares at least 60% of its words with one of the person's 2 previous messages (3 words or more).
 * `correction`: the message opens by saying the agent is wrong; a bare « non » answering a question does not count. `abandoned`: the person
 * stopped a run mid-task, seen when the attempt ends or at the next request. `report_bug`: the agent called the tool.
 */
export type StruggleKind = 'tool_error' | 'tool_retry' | 'rephrase' | 'correction' | 'abandoned' | 'report_bug';

/** Content-free: never the person's words. `summary` and `tried` are the agent's own, scrubbed of emails and long numbers. */
export interface AgentStruggle {
  readonly event: 'agent.struggle';
  readonly kind: StruggleKind;
  readonly agent: string;
  /** Stable for one agent, kind and tool: the host files one task per fingerprint. */
  readonly fingerprint: string;
  readonly conversationId: number;
  readonly taskId: number;
  readonly tool?: string;
  /** Only when the agent passed one to `report_bug`; a host that knows the request adds it in its sink. */
  readonly req_id?: string;
  readonly summary?: string;
  readonly tried?: string;
}
export type StruggleSink = (struggle: AgentStruggle) => void | Promise<void>;

/** Without a host sink an event is one structured log line, so nothing is lost before a host wires one. */
const logLine: StruggleSink = struggle => { console.log(JSON.stringify({ level: 'warn', ...struggle })); };
let hostSink: StruggleSink | undefined;
/** The host's sink for every agent of this process that names none: the agent home calls it once, so apps write no code. */
export function setStruggleSink(sink: StruggleSink | undefined): void { hostSink = sink; }

const MAX_TEXT = 200, MAX_SEEN = 500;
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
    return shared / new Set([...said, ...before]).size >= 0.6;
  });
}
const WRONG = /^\s*(c'est faux|c’est faux|c'est pas (ça|ca)|c’est pas (ça|ca)|ce n'est pas (ça|ca)|ce n’est pas (ça|ca)|tu te trompes|vous vous trompez|faux\b|(no|non)[,.! ]+(that's|that’s|it's|it’s|c'est|c’est|ce n'est|ce n’est|pas|not|wrong)|that's wrong|that’s wrong|you're wrong|you’re wrong|wrong\b|incorrect\b|not what i asked)/i;
const BARE_NO = /^\s*(no|non)\s*[.!]*\s*$/i;

export interface StruggleOptions {
  /** The agent's id, in the fingerprint. */
  readonly agent: string;
  /** Default: the sink of `setStruggleSink`, else one log line. A throw is ignored: reporting never fails the agent. */
  readonly sink?: StruggleSink;
  /** False when the agent already has a tool named `report_bug`. Default true. */
  readonly tool?: boolean;
  /** Default `agent.<agent>.struggle`. */
  readonly name?: string;
}

/** The S6 extension: the `report_bug` tool and the automatic events. It changes no result and no request. */
export function createStruggleExtension(options: StruggleOptions): Extension {
  const seen = new Set<string>();
  const emit = async (once: string, ids: { readonly conversationId: unknown; readonly taskId: unknown }, kind: StruggleKind, fields: Pick<AgentStruggle, 'tool' | 'req_id' | 'summary' | 'tried'> = {}): Promise<void> => {
    const key = `${String(ids.conversationId)}:${once}`;
    if (seen.has(key)) return;
    if (seen.size >= MAX_SEEN) seen.delete(seen.values().next().value!);
    seen.add(key);
    const fingerprint = createHash('sha256').update(JSON.stringify([options.agent, kind, fields.tool ?? null])).digest('hex').slice(0, 16);
    try {
      await (options.sink ?? hostSink ?? logLine)({ event: 'agent.struggle', kind, agent: options.agent, fingerprint, conversationId: Number(ids.conversationId), taskId: Number(ids.taskId), ...fields });
    } catch { /* the host's sink owns its failures */ }
  };
  const tool = jsonSchemaTool<{ summary: string; tried: string; tool?: string; req_id?: string }>({
    name: REPORT_BUG_TOOL,
    description: "Tell the app's team that something is broken: a tool failed, something you should be able to do is impossible, or the person says you are wrong. Describe the problem in general terms: never the person's words, name, health, money or any personal value.",
    parameters: { type: 'object', properties: {
      summary: { type: 'string', description: 'What is broken, in one short general sentence.' },
      tried: { type: 'string', description: 'What you tried, in general terms.' },
      tool: { type: 'string', description: 'The tool involved, if any.' },
      req_id: { type: 'string', description: 'The request id, if you have one.' },
    }, required: ['summary', 'tried'] },
    execute: async (args, api) => {
      await emit(`bug:${api.callId}`, api, 'report_bug', { summary: scrub(args.summary), tried: scrub(args.tried), ...(args.tool ? { tool: scrub(args.tool) } : {}), ...(args.req_id ? { req_id: scrub(args.req_id) } : {}) });
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
