import * as SQLite from 'expo-sqlite';

import { BackupBlock } from '@/domain/backup';
import {
  ActiveTimer,
  NewTimeBlock,
  TimerPause,
  TimeBlock,
  splitTimerIntoBlocksExcludingPauses,
  toIsoMinute,
} from '@/domain/time';

type TimeBlockRow = {
  id: number;
  work_date: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  block_type?: TimeBlock['blockType'];
  source: TimeBlock['source'];
  created_at: string;
  updated_at: string;
};

type ActiveTimerRow = {
  id: number;
  start_at: string;
  paused_at?: string | null;
  created_at: string;
};

type TimerPauseRow = {
  id: number;
  start_at: string;
  end_at: string | null;
};

type BackupStateRow = {
  id: number;
  status: BackupState['status'];
  last_successful_fingerprint: string | null;
  last_successful_at: string | null;
  last_successful_file_id: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export type BackupState = {
  status: 'idle' | 'uploading' | 'success' | 'error' | 'restored';
  lastSuccessfulFingerprint: string | null;
  lastSuccessfulAt: string | null;
  lastSuccessfulFileId: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

function mapBlock(row: TimeBlockRow): TimeBlock {
  return {
    id: row.id,
    workDate: row.work_date,
    startAt: row.start_at,
    endAt: row.end_at,
    durationMinutes: row.duration_minutes,
    blockType: row.block_type ?? 'direct',
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTimerPause(row: TimerPauseRow): TimerPause {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
  };
}

function mapActiveTimer(row: ActiveTimerRow | null, pauses: TimerPause[]): ActiveTimer | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    startAt: row.start_at,
    pausedAt: row.paused_at ?? null,
    pauses,
    createdAt: row.created_at,
  };
}

function mapBackupState(row: BackupStateRow | null): BackupState {
  if (!row) {
    return {
      status: 'idle',
      lastSuccessfulFingerprint: null,
      lastSuccessfulAt: null,
      lastSuccessfulFileId: null,
      lastAttemptAt: null,
      lastError: null,
      updatedAt: null,
    };
  }

  return {
    status: row.status,
    lastSuccessfulFingerprint: row.last_successful_fingerprint,
    lastSuccessfulAt: row.last_successful_at,
    lastSuccessfulFileId: row.last_successful_file_id,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export async function openMedHoursDatabase() {
  const db = await SQLite.openDatabaseAsync('med-hours.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS time_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_date TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK(duration_minutes >= 0),
      block_type TEXT NOT NULL DEFAULT 'direct' CHECK(block_type IN ('direct', 'indirect')),
      source TEXT NOT NULL CHECK(source IN ('manual', 'timer')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS time_blocks_work_date_idx
      ON time_blocks(work_date, start_at, end_at);
    CREATE TABLE IF NOT EXISTS active_timer (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      start_at TEXT NOT NULL,
      paused_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS active_timer_pauses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_at TEXT NOT NULL,
      end_at TEXT
    );
    CREATE TABLE IF NOT EXISTS backup_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      status TEXT NOT NULL CHECK(status IN ('idle', 'uploading', 'success', 'error', 'restored')),
      last_successful_fingerprint TEXT,
      last_successful_at TEXT,
      last_successful_file_id TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const blockColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(time_blocks)`);
  if (!blockColumns.some((column) => column.name === 'block_type')) {
    await db.execAsync(
      `ALTER TABLE time_blocks ADD COLUMN block_type TEXT NOT NULL DEFAULT 'direct' CHECK(block_type IN ('direct', 'indirect'));`,
    );
  }

  const activeTimerColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(active_timer)`);
  if (!activeTimerColumns.some((column) => column.name === 'paused_at')) {
    await db.execAsync(`ALTER TABLE active_timer ADD COLUMN paused_at TEXT;`);
  }

  await db.execAsync(`
    DROP TABLE IF EXISTS indirect_blocks;
    PRAGMA user_version = 5;
  `);

  return db;
}

export class TimeRepository {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async listBlocks() {
    const rows = await this.db.getAllAsync<TimeBlockRow>(
      `SELECT * FROM time_blocks ORDER BY work_date DESC, start_at DESC`,
    );
    return rows.map(mapBlock);
  }

  async getDatabaseUserVersion() {
    const row = await this.db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version`);
    return row?.user_version ?? 0;
  }

  async getBackupState() {
    const row = await this.db.getFirstAsync<BackupStateRow>(
      `SELECT * FROM backup_state WHERE id = 1`,
    );
    return mapBackupState(row);
  }

  async updateBackupState(state: Partial<Omit<BackupState, 'updatedAt'>>) {
    const current = await this.getBackupState();
    const next: BackupState = {
      ...current,
      ...state,
      updatedAt: new Date().toISOString(),
    };

    await this.db.runAsync(
      `
        INSERT INTO backup_state (
          id,
          status,
          last_successful_fingerprint,
          last_successful_at,
          last_successful_file_id,
          last_attempt_at,
          last_error,
          updated_at
        )
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          last_successful_fingerprint = excluded.last_successful_fingerprint,
          last_successful_at = excluded.last_successful_at,
          last_successful_file_id = excluded.last_successful_file_id,
          last_attempt_at = excluded.last_attempt_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `,
      next.status,
      next.lastSuccessfulFingerprint,
      next.lastSuccessfulAt,
      next.lastSuccessfulFileId,
      next.lastAttemptAt,
      next.lastError,
      next.updatedAt,
    );
  }

  async listBlocksForDate(workDate: string) {
    const rows = await this.db.getAllAsync<TimeBlockRow>(
      `SELECT * FROM time_blocks WHERE work_date = ? ORDER BY start_at ASC`,
      workDate,
    );
    return rows.map(mapBlock);
  }

  async getActiveTimer() {
    const row = await this.db.getFirstAsync<ActiveTimerRow>(
      `SELECT * FROM active_timer WHERE id = 1`,
    );
    const pauses = await this.db.getAllAsync<TimerPauseRow>(
      `SELECT * FROM active_timer_pauses ORDER BY start_at ASC`,
    );
    return mapActiveTimer(row, pauses.map(mapTimerPause));
  }

  async startTimer(now = new Date()) {
    const existing = await this.getActiveTimer();
    if (existing) {
      throw new Error('A timer is already running.');
    }

    const timestamp = toIsoMinute(now);
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM active_timer_pauses`);
      await this.db.runAsync(
        `INSERT INTO active_timer (id, start_at, paused_at, created_at) VALUES (1, ?, NULL, ?)`,
        timestamp,
        timestamp,
      );
    });
  }

  async stopTimer(now = new Date()) {
    const active = await this.getActiveTimer();
    if (!active) {
      throw new Error('No timer is running.');
    }

    const stopAt = new Date(toIsoMinute(now));
    const pauses = active.pausedAt
      ? active.pauses.map((pause) => (pause.endAt ? pause : { ...pause, endAt: active.pausedAt }))
      : active.pauses;
    const blocks = splitTimerIntoBlocksExcludingPauses(new Date(active.startAt), stopAt, pauses);

    if (blocks.length === 0) {
      throw new Error('Timer has no worked time to save.');
    }

    await this.db.withTransactionAsync(async () => {
      for (const block of blocks) {
        await this.assertNoOverlap(block);
        await this.insertBlock(block);
      }

      await this.db.runAsync(`DELETE FROM active_timer_pauses`);
      await this.db.runAsync(`DELETE FROM active_timer WHERE id = 1`);
    });
  }

  async pauseTimer(now = new Date()) {
    const active = await this.getActiveTimer();
    if (!active) {
      throw new Error('No timer is running.');
    }

    if (active.pausedAt) {
      throw new Error('Timer is already paused.');
    }

    const timestamp = toIsoMinute(now);
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`UPDATE active_timer SET paused_at = ? WHERE id = 1`, timestamp);
      await this.db.runAsync(
        `INSERT INTO active_timer_pauses (start_at, end_at) VALUES (?, NULL)`,
        timestamp,
      );
    });
  }

  async resumeTimer(now = new Date()) {
    const active = await this.getActiveTimer();
    if (!active?.pausedAt) {
      throw new Error('Timer is not paused.');
    }

    const timestamp = toIsoMinute(now);
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `
          UPDATE active_timer_pauses
          SET end_at = ?
          WHERE end_at IS NULL
        `,
        timestamp,
      );
      await this.db.runAsync(`UPDATE active_timer SET paused_at = NULL WHERE id = 1`);
    });
  }

  async cancelTimer() {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM active_timer_pauses`);
      await this.db.runAsync(`DELETE FROM active_timer WHERE id = 1`);
    });
  }

  async addManualBlock(block: NewTimeBlock) {
    await this.assertNoOverlap(block);
    await this.insertBlock(block);
  }

  async updateManualBlock(id: number, block: NewTimeBlock) {
    const existing = await this.db.getFirstAsync<TimeBlockRow>(
      `SELECT * FROM time_blocks WHERE id = ?`,
      id,
    );

    if (!existing) {
      throw new Error('Time block no longer exists.');
    }

    if (existing.source !== 'manual') {
      throw new Error('Timer-created blocks cannot be edited.');
    }

    await this.assertNoOverlap(block, id);
    await this.db.runAsync(
      `
        UPDATE time_blocks
        SET work_date = ?,
            start_at = ?,
            end_at = ?,
            duration_minutes = ?,
            block_type = ?,
            source = ?,
            updated_at = ?
        WHERE id = ?
      `,
      block.workDate,
      block.startAt,
      block.endAt,
      block.durationMinutes,
      block.blockType,
      block.source,
      new Date().toISOString(),
      id,
    );
  }

  async deleteBlock(id: number) {
    await this.db.runAsync(`DELETE FROM time_blocks WHERE id = ?`, id);
  }

  async replaceBlocksFromBackup(blocks: BackupBlock[], fingerprint: string) {
    const restoredAt = new Date().toISOString();

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM active_timer_pauses`);
      await this.db.runAsync(`DELETE FROM active_timer WHERE id = 1`);
      await this.db.runAsync(`DELETE FROM time_blocks`);

      for (const block of blocks) {
        await this.insertBackupBlock(block, restoredAt);
      }

      await this.writeBackupStateInCurrentTransaction({
        status: 'restored',
        lastSuccessfulFingerprint: fingerprint,
        lastSuccessfulAt: restoredAt,
        lastSuccessfulFileId: null,
        lastAttemptAt: restoredAt,
        lastError: null,
        updatedAt: restoredAt,
      });
    });
  }

  private async insertBlock(block: NewTimeBlock) {
    const now = new Date().toISOString();
    await this.db.runAsync(
      `
        INSERT INTO time_blocks (
          work_date,
          start_at,
          end_at,
          duration_minutes,
          block_type,
          source,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      block.workDate,
      block.startAt,
      block.endAt,
      block.durationMinutes,
      block.blockType,
      block.source,
      now,
      now,
    );
  }

  private async insertBackupBlock(block: BackupBlock, restoredAt: string) {
    const createdAt = block.createdAt ?? restoredAt;
    const updatedAt = block.updatedAt ?? restoredAt;

    await this.db.runAsync(
      `
        INSERT INTO time_blocks (
          work_date,
          start_at,
          end_at,
          duration_minutes,
          block_type,
          source,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      block.workDate,
      block.startAt,
      block.endAt,
      block.durationMinutes,
      block.blockType,
      block.source,
      createdAt,
      updatedAt,
    );
  }

  private async writeBackupStateInCurrentTransaction(state: BackupState) {
    await this.db.runAsync(
      `
        INSERT INTO backup_state (
          id,
          status,
          last_successful_fingerprint,
          last_successful_at,
          last_successful_file_id,
          last_attempt_at,
          last_error,
          updated_at
        )
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          last_successful_fingerprint = excluded.last_successful_fingerprint,
          last_successful_at = excluded.last_successful_at,
          last_successful_file_id = excluded.last_successful_file_id,
          last_attempt_at = excluded.last_attempt_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `,
      state.status,
      state.lastSuccessfulFingerprint,
      state.lastSuccessfulAt,
      state.lastSuccessfulFileId,
      state.lastAttemptAt,
      state.lastError,
      state.updatedAt,
    );
  }

  private async assertNoOverlap(block: NewTimeBlock, ignoreId?: number) {
    const overlap = await this.db.getFirstAsync<{ id: number }>(
      `
        SELECT id
        FROM time_blocks
        WHERE work_date = ?
          AND id != ?
          AND start_at < ?
          AND end_at > ?
        LIMIT 1
      `,
      block.workDate,
      ignoreId ?? -1,
      block.endAt,
      block.startAt,
    );

    if (overlap) {
      throw new Error('This time block overlaps an existing block for that day.');
    }
  }
}
