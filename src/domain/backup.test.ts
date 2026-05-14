import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  backupFileName,
  createBackupSnapshot,
  fingerprintBackupSnapshot,
  parseBackupSnapshot,
} from './backup';
import { TimeBlock } from './time';

const blocks: TimeBlock[] = [
  {
    id: 42,
    workDate: '2026-05-13',
    startAt: '2026-05-13T13:00:00.000Z',
    endAt: '2026-05-13T13:30:00.000Z',
    durationMinutes: 30,
    blockType: 'direct',
    source: 'manual',
    createdAt: '2026-05-13T13:31:00.000Z',
    updatedAt: '2026-05-13T13:31:00.000Z',
  },
  {
    id: 7,
    workDate: '2026-05-14',
    startAt: '2026-05-14T15:00:00.000Z',
    endAt: '2026-05-14T15:15:00.000Z',
    durationMinutes: 15,
    blockType: 'indirect',
    source: 'timer',
    createdAt: '2026-05-14T15:16:00.000Z',
    updatedAt: '2026-05-14T15:16:00.000Z',
  },
];

describe('backup snapshots', () => {
  it('serializes saved blocks without row ids or active timer data', () => {
    const snapshot = createBackupSnapshot({
      appName: 'Med Hours',
      appVersion: '1.0.0',
      blocks,
      databaseUserVersion: 5,
      exportedAt: new Date('2026-05-15T10:00:00.000Z'),
    });

    expect(snapshot).toMatchObject({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: '2026-05-15T10:00:00.000Z',
      database: { userVersion: 5 },
    });
    expect(snapshot.blocks).toHaveLength(2);
    expect(snapshot.blocks[0]).not.toHaveProperty('id');
    expect(JSON.stringify(snapshot)).not.toContain('activeTimer');
  });

  it('uses stable fingerprints for equivalent block content', () => {
    const first = createBackupSnapshot({
      appName: 'Med Hours',
      blocks,
      databaseUserVersion: 5,
      exportedAt: new Date('2026-05-15T10:00:00.000Z'),
    });
    const second = createBackupSnapshot({
      appName: 'Med Hours',
      blocks: [...blocks]
        .reverse()
        .map((entry) => ({ ...entry, createdAt: '2026-05-20T10:00:00.000Z' })),
      databaseUserVersion: 5,
      exportedAt: new Date('2026-05-16T10:00:00.000Z'),
    });

    expect(fingerprintBackupSnapshot(first)).toBe(fingerprintBackupSnapshot(second));
  });

  it('validates round-tripped JSON snapshots', () => {
    const snapshot = createBackupSnapshot({
      appName: 'Med Hours',
      blocks,
      databaseUserVersion: 5,
    });

    expect(parseBackupSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('rejects malformed and overlapping backup files', () => {
    expect(() => parseBackupSnapshot('{')).toThrow('Backup file is not valid JSON.');
    expect(() =>
      parseBackupSnapshot(
        JSON.stringify({
          format: BACKUP_FORMAT,
          version: 1,
          exportedAt: '2026-05-15T10:00:00.000Z',
          app: { name: 'Med Hours' },
          database: { userVersion: 5 },
          blocks: [
            {
              workDate: '2026-05-13',
              startAt: '2026-05-13T13:00:00.000Z',
              endAt: '2026-05-13T13:30:00.000Z',
              durationMinutes: 30,
              blockType: 'direct',
              source: 'manual',
            },
            {
              workDate: '2026-05-13',
              startAt: '2026-05-13T13:15:00.000Z',
              endAt: '2026-05-13T13:45:00.000Z',
              durationMinutes: 30,
              blockType: 'direct',
              source: 'manual',
            },
          ],
        }),
      ),
    ).toThrow('Backup contains overlapping time blocks.');
  });

  it('uses the expected app-data backup filename format', () => {
    expect(backupFileName(new Date('2026-05-15T10:11:12.000Z'))).toBe(
      'med-hours-backup-20260515T101112Z.json',
    );
  });
});
