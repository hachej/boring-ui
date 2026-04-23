import { randomUUID } from "node:crypto";
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
} from "../../../shared/session.js";
import type { UIMessage } from "../../../shared/message.js";

interface InMemorySession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  messages: UIMessage[];
}

export class PiSessionStore implements SessionStore {
  private sessions = new Map<string, InMemorySession>();

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    return Array.from(this.sessions.values())
      .filter((s) => s.workspaceId === ctx.workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary);
  }

  async create(
    ctx: SessionCtx,
    init?: { title?: string },
  ): Promise<SessionSummary> {
    const now = new Date().toISOString();
    const session: InMemorySession = {
      id: randomUUID(),
      title: init?.title ?? "New session",
      createdAt: now,
      updatedAt: now,
      workspaceId: ctx.workspaceId,
      messages: [],
    };
    this.sessions.set(session.id, session);
    return toSummary(session);
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== ctx.workspaceId) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return { ...toSummary(session), messages: session.messages };
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && session.workspaceId === ctx.workspaceId) {
      this.sessions.delete(sessionId);
    }
  }

  getInternal(sessionId: string): InMemorySession | undefined {
    return this.sessions.get(sessionId);
  }

  touchSession(sessionId: string, title?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.updatedAt = new Date().toISOString();
    if (title) session.title = title;
  }
}

function toSummary(s: InMemorySession): SessionSummary {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    turnCount: s.messages.filter((m) => m.role === "user").length,
  };
}
