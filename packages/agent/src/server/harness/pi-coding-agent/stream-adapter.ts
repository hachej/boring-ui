import type { AgentSessionEvent, AgentSessionEventListener } from "@mariozechner/pi-coding-agent";
import type { UIMessageChunk } from "../../../shared/message.js";

function chunk(data: Record<string, unknown>): UIMessageChunk {
  return data as unknown as UIMessageChunk;
}

type FileChangeOp = "write" | "edit" | "unlink" | "rename" | "mkdir";

interface FileChangeData {
  op: FileChangeOp;
  path: string;
  oldPath?: string;
  size?: number;
  timestamp: string;
}

const FILE_CHANGE_OPS: ReadonlySet<FileChangeOp> = new Set([
  "write",
  "edit",
  "unlink",
  "rename",
  "mkdir",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFileChangeEntry(value: unknown): FileChangeData | null {
  if (!isRecord(value)) return null;

  const op = value.op;
  if (typeof op !== "string" || !FILE_CHANGE_OPS.has(op as FileChangeOp)) {
    return null;
  }

  const path = value.path;
  if (typeof path !== "string" || path.length === 0) {
    return null;
  }

  const timestamp = typeof value.timestamp === "string"
    ? value.timestamp
    : new Date().toISOString();

  const normalized: FileChangeData = {
    op: op as FileChangeOp,
    path,
    timestamp,
  };

  if (typeof value.oldPath === "string" && value.oldPath.length > 0) {
    normalized.oldPath = value.oldPath;
  }

  if (typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0) {
    normalized.size = value.size;
  }

  return normalized;
}

function extractFileChanges(details: unknown): FileChangeData[] {
  if (!isRecord(details)) return [];

  const entries = details.fileChanges;
  if (Array.isArray(entries)) {
    return entries
      .map(normalizeFileChangeEntry)
      .filter((entry): entry is FileChangeData => entry !== null);
  }

  const singleEntry = normalizeFileChangeEntry(details.fileChange);
  return singleEntry ? [singleEntry] : [];
}

export function piEventToChunks(event: AgentSessionEvent): UIMessageChunk[] {
  switch (event.type) {
    case "message_start": {
      const messageId = (event as any).message?.id;
      return [
        chunk(messageId ? { type: "start", messageId } : { type: "start" }),
      ];
    }

    case "message_update": {
      const ame = event.assistantMessageEvent;
      switch (ame.type) {
        case "start":
          return [];

        case "text_start":
          return [chunk({ type: "text-start", id: String(ame.contentIndex) })];

        case "text_delta":
          return [chunk({ type: "text-delta", id: String(ame.contentIndex), delta: ame.delta })];

        case "text_end":
          return [chunk({ type: "text-end", id: String(ame.contentIndex) })];

        case "thinking_start":
          return [chunk({ type: "reasoning-start", id: String(ame.contentIndex) })];

        case "thinking_delta":
          return [chunk({ type: "reasoning-delta", id: String(ame.contentIndex), delta: ame.delta })];

        case "thinking_end":
          return [chunk({ type: "reasoning-end", id: String(ame.contentIndex) })];

        case "toolcall_start":
          // pi streams contentIndex before toolCallId exists; defer until toolcall_end.
          return [];

        case "toolcall_delta":
          return [];

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
      const fileChangeChunks = extractFileChanges(event.result?.details).map((fileChange) =>
        chunk({
          type: "data-file-changed",
          data: {
            ...fileChange,
            toolCallId: event.toolCallId,
          },
        }),
      );
      return [
        ...fileChangeChunks,
        chunk({
          type: "tool-output-available",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: event.result,
        }),
      ];

    case "message_end":
      return [];

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
