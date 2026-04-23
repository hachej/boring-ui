import type { AgentSessionEvent, AgentSessionEventListener } from "@mariozechner/pi-coding-agent";
import type { UIMessageChunk } from "../../../shared/message.js";

function chunk(data: Record<string, unknown>): UIMessageChunk {
  return data as unknown as UIMessageChunk;
}

export function piEventToChunks(event: AgentSessionEvent): UIMessageChunk[] {
  switch (event.type) {
    case "message_start":
      return [chunk({ type: "message-start" })];

    case "message_update": {
      const ame = event.assistantMessageEvent;
      switch (ame.type) {
        case "start":
          return [];

        case "text_start":
          return [chunk({ type: "text-start", contentIndex: ame.contentIndex })];

        case "text_delta":
          return [chunk({ type: "text-delta", contentIndex: ame.contentIndex, delta: ame.delta })];

        case "text_end":
          return [chunk({ type: "text-end", contentIndex: ame.contentIndex, content: ame.content })];

        case "thinking_start":
          return [chunk({ type: "reasoning-start", contentIndex: ame.contentIndex })];

        case "thinking_delta":
          return [chunk({ type: "reasoning-delta", contentIndex: ame.contentIndex, delta: ame.delta })];

        case "thinking_end":
          return [chunk({ type: "reasoning-end", contentIndex: ame.contentIndex, content: ame.content })];

        case "toolcall_start":
          return [chunk({ type: "tool-input-start", contentIndex: ame.contentIndex })];

        case "toolcall_delta":
          return [chunk({ type: "tool-input-delta", contentIndex: ame.contentIndex, delta: ame.delta })];

        case "toolcall_end":
          return [
            chunk({
              type: "tool-input-available",
              toolCallId: ame.toolCall.id,
              toolName: ame.toolCall.name,
              input: ame.toolCall.arguments,
            }),
          ];

        case "done":
          return [
            chunk({
              type: "data-usage",
              data: {
                input: ame.message.usage.input,
                output: ame.message.usage.output,
                cost: ame.message.usage.cost.total,
              },
            }),
            chunk({ type: "finish" }),
          ];

        case "error":
          if (ame.reason === "aborted") {
            return [
              chunk({ type: "error", errorText: "Aborted" }),
              chunk({ type: "finish" }),
            ];
          }
          return [
            chunk({
              type: "error",
              errorText: ame.error.errorMessage ?? "Unknown error",
            }),
            chunk({ type: "finish" }),
          ];

        default:
          return [
            chunk({
              type: "data-status",
              data: {
                level: "warn",
                msg: `unknown pi assistant message event: ${(ame as any).type}`,
              },
            }),
          ];
      }
    }

    case "tool_execution_start":
      return [];

    case "tool_execution_update":
      return [];

    case "tool_execution_end":
      if (event.isError) {
        return [
          chunk({
            type: "tool-output-error",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            errorText:
              event.result?.content?.[0]?.text ??
              JSON.stringify(event.result),
          }),
        ];
      }
      return [
        chunk({
          type: "tool-output-available",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: event.result,
        }),
      ];

    case "message_end":
      return [chunk({ type: "message-end" })];

    case "agent_start":
    case "agent_end":
    case "turn_start":
    case "turn_end":
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
      return [];

    default:
      return [
        chunk({
          type: "data-status",
          data: {
            level: "warn",
            msg: `unknown pi session event: ${(event as any).type}`,
          },
        }),
      ];
  }
}

export interface ChunkSink {
  push(chunk: UIMessageChunk): void;
  end(): void;
  error(err: unknown): void;
}

export function createEventListener(sink: ChunkSink): AgentSessionEventListener {
  return (event: AgentSessionEvent) => {
    const chunks = piEventToChunks(event);
    for (const c of chunks) {
      sink.push(c);
    }
    if (event.type === "agent_end") {
      sink.end();
    }
  };
}
