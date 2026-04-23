import type { AgentSessionEvent, AgentSessionEventListener } from "@mariozechner/pi-coding-agent";
import type { UIMessageChunk } from "../../../shared/message.js";

export function piEventToChunks(event: AgentSessionEvent): UIMessageChunk[] {
  switch (event.type) {
    case "message_start":
      return [{ type: "message-start" } as UIMessageChunk];

    case "message_update": {
      const ame = event.assistantMessageEvent;
      switch (ame.type) {
        case "text_delta":
          return [{ type: "text-delta", delta: ame.delta } as UIMessageChunk];

        case "thinking_delta":
          return [{ type: "reasoning-delta", delta: ame.delta } as UIMessageChunk];

        case "toolcall_end":
          return [
            {
              type: "tool-call",
              toolCallId: ame.toolCall.id,
              toolName: ame.toolCall.name,
              args: ame.toolCall.arguments,
            } as UIMessageChunk,
          ];

        default:
          return [];
      }
    }

    case "tool_execution_end":
      return [
        {
          type: "tool-result",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        } as UIMessageChunk,
      ];

    case "message_end":
      return [{ type: "message-end" } as UIMessageChunk];

    default:
      return [];
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
    for (const chunk of chunks) {
      sink.push(chunk);
    }
    if (event.type === "agent_end") {
      sink.end();
    }
  };
}
