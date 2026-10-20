import { DatabaseSync } from 'node:sqlite';
import type { Config, Report, PipelineEvent, PipelineStage } from './types.js';

export type ScanStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface SavedScan {
  id: string;
  label: string;
  url: string;
  status: ScanStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  completed: number;
  total: number;
  current: string;
  error: string | null;
  summary: Report['summary'] | null;
  settings: Omit<Config, 'output'>;
  hasReport: boolean;
  pipeline: PipelineEvent[];
}

export class PanelStore {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL,
        status TEXT NOT NULL, createdAt TEXT NOT NULL,
        startedAt TEXT, finishedAt TEXT, completed INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL, current TEXT NOT NULL DEFAULT '', error TEXT,
        summary TEXT, settings TEXT NOT NULL, hasReport INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS scans_created ON scans(createdAt DESC);
    `);
    // Additive migration preserves existing databases and all saved scan history.
    const columns = this.db.prepare('PRAGMA table_info(scans)').all();
    if (!columns.some((column) => column.name === 'pipeline'))
      this.db.exec("ALTER TABLE scans ADD COLUMN pipeline TEXT NOT NULL DEFAULT '[]'");
    for (const row of this.db
      .prepare("SELECT id FROM scans WHERE status IN ('queued', 'running')")
      .all()) {
      this.recordStage(
        String(row.id),
        'interrupted',
        'The panel stopped before this scan finished.',
      );
    }
    this.db
      .prepare(
        `UPDATE scans SET status = 'interrupted', finishedAt = ?,
      error = 'The panel stopped before this scan finished. Use Run again to retry.'
      WHERE status IN ('queued', 'running')`,
      )
      .run(new Date().toISOString());
  }
  private decode(row: unknown): SavedScan {
    const data = row as Record<string, unknown>;
    return {
      ...data,
      settings: JSON.parse(data.settings as string),
      summary: data.summary ? JSON.parse(data.summary as string) : null,
      hasReport: Boolean(data.hasReport),
      pipeline: JSON.parse(data.pipeline as string),
    } as SavedScan;
  }
  get(id: string): SavedScan | undefined {
    const row = this.db.prepare('SELECT * FROM scans WHERE id = ?').get(id);
    return row ? this.decode(row) : undefined;
  }
  create(id: string, label: string, config: Config): SavedScan {
    const { output: _output, ...settings } = config;
    this.db
      .prepare(
        `INSERT INTO scans (id, label, url, status, createdAt, total, settings)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      )
      .run(
        id,
        label,
        config.url,
        new Date().toISOString(),
        config.routes.length * config.modes.length * config.viewports.length,
        JSON.stringify(settings),
      );
    this.recordStage(id, 'queued', 'Waiting for an available scan slot.');
    return this.get(id)!;
  }
  recordStage(id: string, stage: PipelineStage, detail: string): void {
    const record = this.get(id);
    if (!record || record.pipeline.at(-1)?.stage === stage) return;
    const event: PipelineEvent = { stage, at: new Date().toISOString(), detail };
    this.db
      .prepare('UPDATE scans SET pipeline = ? WHERE id = ?')
      .run(JSON.stringify([...record.pipeline, event]), id);
  }
  update(id: string, values: Partial<Omit<SavedScan, 'id' | 'settings'>>): void {
    const allowed = [
      'status',
      'startedAt',
      'finishedAt',
      'completed',
      'current',
      'error',
      'summary',
      'hasReport',
    ];
    const entries = Object.entries(values).filter(([key]) => allowed.includes(key));
    if (!entries.length) return;
    this.db
      .prepare(`UPDATE scans SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
      .run(
        ...entries.map(([key, value]) =>
          key === 'summary'
            ? JSON.stringify(value)
            : typeof value === 'boolean'
              ? Number(value)
              : (value as string | number | null),
        ),
        id,
      );
  }
  activeCount(): number {
    return Number(
      this.db
        .prepare("SELECT count(*) AS n FROM scans WHERE status IN ('queued', 'running')")
        .get()!.n,
    );
  }
  list(query: string, status: string, page: number) {
    // instr treats % and _ literally and keeps search values out of SQL syntax.
    const where = `WHERE (instr(lower(url), lower(?)) > 0 OR instr(lower(label), lower(?)) > 0)
      AND (? = '' OR status = ?)`;
    const args = [query, query, status, status];
    const total = Number(
      this.db.prepare(`SELECT count(*) AS n FROM scans ${where}`).get(...args)!.n,
    );
    const scans = this.db
      .prepare(`SELECT * FROM scans ${where} ORDER BY createdAt DESC, rowid DESC LIMIT 20 OFFSET ?`)
      .all(...args, (page - 1) * 20)
      .map((row) => this.decode(row));
    const stats = this.db
      .prepare(
        `SELECT count(*) AS total,
      coalesce(sum(status IN ('queued', 'running')), 0) AS active,
      coalesce(sum(status = 'completed'), 0) AS completed,
      coalesce(sum(status IN ('failed', 'interrupted')), 0) AS failed FROM scans`,
      )
      .get();
    const activeScans = this.db
      .prepare(
        "SELECT * FROM scans WHERE status IN ('running', 'queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, createdAt, rowid",
      )
      .all()
      .map((row) => this.decode(row));
    return { scans, total, page, pageSize: 20, stats, activeScans };
  }
  delete(id: string): void {
    this.db.prepare('DELETE FROM scans WHERE id = ?').run(id);
  }
  close(): void {
    this.db.close();
  }
}
