/**
 * Tab command bus — ported from boring-macro ws.py (TabCommandBus).
 *
 * In-memory command queue with WebSocket broadcast to connected frontends.
 * Commands are ephemeral (lost on restart) — by design.
 * The source of truth for tab state is always the frontend (Dockview).
 */

import type { WebSocket } from 'ws'
import type { FastifyInstance, FastifyRequest } from 'fastify'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TabCommand {
  id: number
  seriesId: string
  mode: string
}

// ---------------------------------------------------------------------------
// TabCommandBus
// ---------------------------------------------------------------------------

export class TabCommandBus {
  private commands: Map<number, TabCommand> = new Map()
  private nextId = 1
  private clients: Set<WebSocket> = new Set()

  /** Add a tab command and broadcast to all connected clients. */
  push(seriesId: string, mode: string = 'chart'): TabCommand {
    const cmd: TabCommand = {
      id: this.nextId,
      seriesId,
      mode,
    }
    this.commands.set(this.nextId, cmd)
    this.nextId++
    this.broadcast(cmd)
    return cmd
  }

  /** Return all unprocessed commands. */
  listPending(): TabCommand[] {
    return Array.from(this.commands.values())
  }

  /** Remove a command (frontend processed it). Returns true if found. */
  markProcessed(cmdId: number): boolean {
    return this.commands.delete(cmdId)
  }

  /** Send command to all connected WebSocket clients. */
  broadcast(cmd: TabCommand): void {
    const msg = JSON.stringify(cmd)
    const dead: WebSocket[] = []

    for (const ws of this.clients) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg)
        } else {
          dead.push(ws)
        }
      } catch {
        dead.push(ws)
      }
    }

    for (const ws of dead) {
      this.clients.delete(ws)
    }
  }

  /**
   * Register WebSocket route on the given Fastify app.
   *
   * Expects @fastify/websocket to be registered on the app.
   * The route is at /ws/tabs (root-level, NOT under any prefix).
   */
  registerWebSocket(app: FastifyInstance): void {
    app.get('/ws/tabs', { websocket: true } as any, (socket: WebSocket, _req: FastifyRequest) => {
      this.clients.add(socket)

      // Send any pending commands on connect
      for (const cmd of this.commands.values()) {
        try {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(cmd))
          }
        } catch {
          // ignore
        }
      }

      // Listen for acks or pings
      socket.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(String(data))
          if (msg.type === 'ack' && typeof msg.id === 'number') {
            this.markProcessed(msg.id)
          } else if (msg.type === 'ping') {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: 'pong' }))
            }
          }
        } catch {
          // ignore parse errors
        }
      })

      socket.on('close', () => {
        this.clients.delete(socket)
      })

      socket.on('error', () => {
        this.clients.delete(socket)
      })
    })
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const tabBus = new TabCommandBus()
