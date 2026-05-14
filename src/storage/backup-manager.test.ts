import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackupSnapshot } from '@/domain/backup';
import { TimeBlock } from '@/domain/time';
import { AUTO_BACKUP_DEBOUNCE_MS, BackupManager, BackupRepository } from './backup-manager';
import { BackupState } from './database';
import { DriveBackupClient, DriveBackupFile, GoogleDriveUser } from './google-drive-backup';

const block: TimeBlock = {
  id: 1,
  workDate: '2026-05-13',
  startAt: '2026-05-13T13:00:00.000Z',
  endAt: '2026-05-13T13:30:00.000Z',
  durationMinutes: 30,
  blockType: 'direct',
  source: 'manual',
  createdAt: '2026-05-13T13:31:00.000Z',
  updatedAt: '2026-05-13T13:31:00.000Z',
};

function initialBackupState(): BackupState {
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

class FakeRepository implements BackupRepository {
  blocks = [block];
  state = initialBackupState();
  restored: BackupSnapshot['blocks'] | null = null;

  async listBlocks() {
    return this.blocks;
  }

  async getDatabaseUserVersion() {
    return 5;
  }

  async getBackupState() {
    return this.state;
  }

  async updateBackupState(next: Partial<Omit<BackupState, 'updatedAt'>>) {
    this.state = {
      ...this.state,
      ...next,
      updatedAt: '2026-05-15T10:00:00.000Z',
    };
  }

  async replaceBlocksFromBackup(blocks: BackupSnapshot['blocks'], fingerprint: string) {
    this.restored = blocks;
    await this.updateBackupState({
      status: 'restored',
      lastSuccessfulFingerprint: fingerprint,
      lastSuccessfulAt: '2026-05-15T10:00:00.000Z',
      lastError: null,
    });
  }
}

class FakeDriveClient implements DriveBackupClient {
  user: GoogleDriveUser | null = { name: 'Doctor User', email: 'doctor@example.com' };
  files: DriveBackupFile[] = [];
  uploads: BackupSnapshot[] = [];
  uploadImpl: (snapshot: BackupSnapshot) => Promise<DriveBackupFile> = async () => ({
    id: `file-${this.uploads.length}`,
    name: `backup-${this.uploads.length}.json`,
    createdTime: new Date().toISOString(),
  });

  async connect() {
    return this.user;
  }

  async signOut() {
    this.user = null;
  }

  async getCurrentUser() {
    return this.user;
  }

  async uploadSnapshot(snapshot: BackupSnapshot) {
    this.uploads.push(snapshot);
    const file = await this.uploadImpl(snapshot);
    this.files = [file, ...this.files];
    return file;
  }

  async listBackupFiles() {
    return this.files;
  }

  async downloadSnapshot() {
    return this.uploads[0];
  }

  async deleteBackupFile(fileId: string) {
    this.files = this.files.filter((file) => file.id !== fileId);
  }
}

describe('BackupManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces automatic backups and resets after repeated changes', async () => {
    const repository = new FakeRepository();
    const client = new FakeDriveClient();
    const manager = new BackupManager(repository, client, () => {});
    await manager.initialize();

    manager.queueAutoBackup();
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DEBOUNCE_MS - 1);
    manager.queueAutoBackup();
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DEBOUNCE_MS - 1);

    expect(client.uploads).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);

    expect(client.uploads).toHaveLength(1);
  });

  it('lets manual backups bypass the debounce timer', async () => {
    const repository = new FakeRepository();
    const client = new FakeDriveClient();
    const manager = new BackupManager(repository, client, () => {});
    await manager.initialize();

    manager.queueAutoBackup();
    await manager.backupNow();
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DEBOUNCE_MS);

    expect(client.uploads).toHaveLength(1);
  });

  it('schedules one more debounced upload after an in-flight upload sees another change', async () => {
    const repository = new FakeRepository();
    const client = new FakeDriveClient();
    const uploadControls: { finish?: () => void } = {};
    client.uploadImpl = async () =>
      new Promise((resolve) => {
        uploadControls.finish = () =>
          resolve({
            id: `file-${client.uploads.length}`,
            name: `backup-${client.uploads.length}.json`,
            createdTime: new Date().toISOString(),
          });
      });
    const manager = new BackupManager(repository, client, () => {});
    await manager.initialize();

    const firstUpload = manager.backupNow();
    await vi.waitFor(() => expect(client.uploads).toHaveLength(1));

    repository.blocks = [
      {
        ...block,
        id: 2,
        startAt: '2026-05-13T14:00:00.000Z',
        endAt: '2026-05-13T14:30:00.000Z',
      },
    ];
    manager.queueAutoBackup();
    uploadControls.finish?.();
    await firstUpload;
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DEBOUNCE_MS);

    expect(client.uploads).toHaveLength(2);
  });

  it('records errors and retries on the next queued backup', async () => {
    const repository = new FakeRepository();
    const client = new FakeDriveClient();
    client.uploadImpl = async () => {
      throw new Error('No token');
    };
    const manager = new BackupManager(repository, client, () => {});
    await manager.initialize();

    await manager.backupNow();

    expect(repository.state.status).toBe('error');
    expect(repository.state.lastError).toBe('No token');

    client.uploadImpl = async () => ({ id: 'file-ok', name: 'ok.json' });
    manager.queueAutoBackup();
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DEBOUNCE_MS);

    expect(repository.state.status).toBe('success');
    expect(repository.state.lastError).toBeNull();
  });
});
