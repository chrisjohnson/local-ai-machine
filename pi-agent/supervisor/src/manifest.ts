// Flat-file manifest of session records - deliberately not sqlite. A single
// small JSON file is simpler to reason about and inspect for an experiment
// this size (a handful of concurrent sessions, not hundreds), and matches
// the pattern pi's own (unpublished) packages/server/src/storage.ts uses
// for its instances.json (confirmed by reading that source in M-030).
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionRecord } from "./types.js";

export class Manifest {
  private readonly path: string;
  private records: Map<string, SessionRecord> = new Map();

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) {
      this.records = new Map();
      return;
    }
    try {
      const raw = readFileSync(this.path, "utf-8");
      const parsed = JSON.parse(raw) as SessionRecord[];
      this.records = new Map(parsed.map((r) => [r.id, r]));
    } catch (error) {
      // A corrupt manifest should not crash the whole supervisor - start
      // empty and let existing session directories on disk be orphaned
      // rather than losing the ability to start at all.
      console.error(`manifest: failed to parse ${this.path}, starting empty:`, error);
      this.records = new Map();
    }
  }

  private save(): void {
    // Write-to-temp-then-rename so a crash mid-write never leaves a
    // truncated/corrupt manifest.json behind.
    const tmpPath = `${this.path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify([...this.records.values()], null, 2));
    renameSync(tmpPath, this.path);
  }

  list(): SessionRecord[] {
    return [...this.records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): SessionRecord | undefined {
    return this.records.get(id);
  }

  upsert(record: SessionRecord): void {
    this.records.set(record.id, record);
    this.save();
  }

  remove(id: string): void {
    this.records.delete(id);
    this.save();
  }
}
