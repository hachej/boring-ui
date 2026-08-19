import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/**
 * Minimal host-owned SessionStorage. Pi sees only this interface; the JSONL
 * record stream is owned by the embedding host and is replayed into Maps.
 */
export class HostSessionStorage {
  constructor({ recordPath, metadata, entries = [], leafId = null }) {
    this.recordPath = recordPath;
    this.metadata = metadata;
    this.entries = [...entries];
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
    this.leafId = leafId;
    for (const entry of entries) this.leafId = entry.type === "leaf" ? entry.targetId : entry.id;
  }

  static async create(recordPath, metadata) {
    const storage = new HostSessionStorage({ recordPath, metadata });
    await storage.write({ op: "metadata", metadata });
    return storage;
  }

  static async open(recordPath) {
    const input = await readFile(recordPath, "utf8");
    let metadata;
    let leafId = null;
    const entries = [];
    for (const line of input.split("\n")) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (record.op === "metadata") metadata = record.metadata;
      if (record.op === "entry") entries.push(record.entry);
    }
    if (!metadata) throw new Error("host record stream has no metadata record");
    return new HostSessionStorage({ recordPath, metadata, entries, leafId });
  }

  async write(record) {
    await appendFile(this.recordPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async getMetadata() {
    return this.metadata;
  }

  async getLeafId() {
    return this.leafId;
  }

  async setLeafId(leafId) {
    if (leafId !== null && !this.byId.has(leafId)) throw new Error(`missing host session entry ${leafId}`);
    await this.appendEntry({
      type: "leaf",
      id: await this.createEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    });
  }

  async createEntryId() {
    return randomUUID();
  }

  async appendEntry(entry) {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.type === "leaf" ? entry.targetId : entry.id;
    await this.write({ op: "entry", entry });
  }

  async getEntry(id) {
    return this.byId.get(id);
  }

  async findEntries(type) {
    return this.entries.filter((entry) => entry.type === type);
  }

  async getLabel(id) {
    let label;
    for (const entry of this.entries) {
      if (entry.type === "label" && entry.targetId === id) label = entry.label;
    }
    return label || undefined;
  }

  async getPathToRoot(leafId) {
    const path = [];
    let cursor = leafId;
    const seen = new Set();
    while (cursor !== null) {
      if (seen.has(cursor)) throw new Error(`cycle in host session at ${cursor}`);
      seen.add(cursor);
      const entry = this.byId.get(cursor);
      if (!entry) throw new Error(`missing host session entry ${cursor}`);
      path.push(entry);
      cursor = entry.parentId;
    }
    return path.reverse();
  }

  async getEntries() {
    return [...this.entries];
  }
}
