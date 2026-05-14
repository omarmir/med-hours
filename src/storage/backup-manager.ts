import {
  BackupSnapshot,
  createBackupSnapshot,
  fingerprintBackupSnapshot,
} from '@/domain/backup';
import { TimeBlock } from '@/domain/time';
import { BackupState } from '@/storage/database';
import { DriveBackupClient, DriveBackupFile } from '@/storage/google-drive-backup';

export const AUTO_BACKUP_DEBOUNCE_MS = 5_000;
export const MAX_BACKUP_FILES = 10;

export type BackupRepository = {
  listBlocks: () => Promise<TimeBlock[]>;
  getDatabaseUserVersion: () => Promise<number>;
  getBackupState: () => Promise<BackupState>;
  updateBackupState: (state: Partial<Omit<BackupState, 'updatedAt'>>) => Promise<void>;
  replaceBlocksFromBackup: (blocks: BackupSnapshot['blocks'], fingerprint: string) => Promise<void>;
};

export type BackupRuntimeStatus =
  | 'idle'
  | 'scheduled'
  | 'uploading'
  | 'success'
  | 'error'
  | 'restored';

export type BackupStatusSnapshot = {
  status: BackupRuntimeStatus;
  backupState: BackupState | null;
  files: DriveBackupFile[];
  isConnected: boolean;
  userEmail: string | null;
  userName: string | null;
  error: string | null;
};

export type BackupRestorePreview = {
  file: DriveBackupFile;
  snapshot: BackupSnapshot;
  fingerprint: string;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type TimerApi = {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

type BackupAppMetadata = {
  appName: string;
  appVersion?: string;
};

const defaultTimerApi: TimerApi = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

export class BackupManager {
  private timer: TimerHandle | null = null;
  private uploading = false;
  private pendingAfterUpload = false;
  private status: BackupRuntimeStatus = 'idle';
  private backupState: BackupState | null = null;
  private files: DriveBackupFile[] = [];
  private isConnected = false;
  private userEmail: string | null = null;
  private userName: string | null = null;
  private error: string | null = null;

  constructor(
    private readonly repository: BackupRepository,
    private readonly client: DriveBackupClient,
    private readonly notify: (status: BackupStatusSnapshot) => void,
    private readonly timers: TimerApi = defaultTimerApi,
    private readonly app: BackupAppMetadata = { appName: 'Med Hours' },
  ) {}

  async initialize() {
    this.backupState = await this.repository.getBackupState();

    try {
      const user = await this.client.getCurrentUser();
      this.isConnected = Boolean(user);
      this.userEmail = user?.email ?? null;
      this.userName = user?.name ?? null;

      if (user) {
        await this.refreshFiles();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Google Drive status could not be loaded.';
    }

    this.status = this.backupState?.status ?? 'idle';
    this.emit();

    if (this.backupState?.status === 'error' && this.isConnected) {
      this.queueAutoBackup();
    }
  }

  async connect() {
    const user = await this.client.connect();
    this.isConnected = Boolean(user);
    this.userEmail = user?.email ?? null;
    this.userName = user?.name ?? null;
    this.error = null;
    await this.refreshFiles();
    this.emit();
  }

  async signOut() {
    this.cancelTimer();
    await this.client.signOut();
    this.isConnected = false;
    this.userEmail = null;
    this.userName = null;
    this.files = [];
    this.status = this.backupState?.status ?? 'idle';
    this.emit();
  }

  queueAutoBackup() {
    if (!this.isConnected) {
      return;
    }

    if (this.uploading) {
      this.pendingAfterUpload = true;
      return;
    }

    this.cancelTimer();
    this.status = 'scheduled';
    this.error = null;
    this.emit();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.uploadLatest();
    }, AUTO_BACKUP_DEBOUNCE_MS);
  }

  async backupNow() {
    this.cancelTimer();
    await this.uploadLatest();
  }

  async refreshFiles() {
    if (!this.isConnected) {
      this.files = [];
      this.emit();
      return;
    }

    this.files = await this.client.listBackupFiles();
    this.emit();
  }

  async previewRestore(file: DriveBackupFile): Promise<BackupRestorePreview> {
    const snapshot = await this.client.downloadSnapshot(file.id);
    return {
      file,
      snapshot,
      fingerprint: fingerprintBackupSnapshot(snapshot),
    };
  }

  async restore(preview: BackupRestorePreview) {
    await this.repository.replaceBlocksFromBackup(preview.snapshot.blocks, preview.fingerprint);
    this.backupState = await this.repository.getBackupState();
    this.status = 'restored';
    this.error = null;
    this.emit();
  }

  getSnapshot(): BackupStatusSnapshot {
    return {
      status: this.status,
      backupState: this.backupState,
      files: this.files,
      isConnected: this.isConnected,
      userEmail: this.userEmail,
      userName: this.userName,
      error: this.error,
    };
  }

  dispose() {
    this.cancelTimer();
  }

  private async uploadLatest() {
    if (this.uploading) {
      this.pendingAfterUpload = true;
      return;
    }

    this.uploading = true;
    this.status = 'uploading';
    this.error = null;
    const attemptAt = new Date().toISOString();
    await this.repository.updateBackupState({
      status: 'uploading',
      lastAttemptAt: attemptAt,
      lastError: null,
    });
    this.backupState = await this.repository.getBackupState();
    this.emit();

    try {
      const snapshot = await this.createSnapshot();
      const fingerprint = fingerprintBackupSnapshot(snapshot);

      if (fingerprint === this.backupState?.lastSuccessfulFingerprint) {
        this.status = 'success';
        await this.repository.updateBackupState({
          status: 'success',
          lastError: null,
        });
        this.backupState = await this.repository.getBackupState();
        return;
      }

      const uploadedFile = await this.client.uploadSnapshot(snapshot);
      await this.repository.updateBackupState({
        status: 'success',
        lastSuccessfulFingerprint: fingerprint,
        lastSuccessfulAt: snapshot.exportedAt,
        lastSuccessfulFileId: uploadedFile.id,
        lastAttemptAt: attemptAt,
        lastError: null,
      });
      this.backupState = await this.repository.getBackupState();
      this.status = 'success';
      this.files = await this.client.listBackupFiles();
      await this.pruneOldBackups(this.files);
      this.files = await this.client.listBackupFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup failed.';
      this.status = 'error';
      this.error = message;
      await this.repository.updateBackupState({
        status: 'error',
        lastAttemptAt: attemptAt,
        lastError: message,
      });
      this.backupState = await this.repository.getBackupState();
    } finally {
      this.uploading = false;
      this.emit();

      if (this.pendingAfterUpload) {
        this.pendingAfterUpload = false;
        this.queueAutoBackup();
      }
    }
  }

  private async createSnapshot() {
    return createBackupSnapshot({
      appName: this.app.appName,
      appVersion: this.app.appVersion,
      blocks: await this.repository.listBlocks(),
      databaseUserVersion: await this.repository.getDatabaseUserVersion(),
    });
  }

  private async pruneOldBackups(files: DriveBackupFile[]) {
    const sortedFiles = [...files].sort((first, second) =>
      (second.createdTime ?? second.modifiedTime ?? '').localeCompare(
        first.createdTime ?? first.modifiedTime ?? '',
      ),
    );
    const extraFiles = sortedFiles.slice(MAX_BACKUP_FILES);

    for (const file of extraFiles) {
      await this.client.deleteBackupFile(file.id);
    }
  }

  private cancelTimer() {
    if (!this.timer) {
      return;
    }

    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private emit() {
    this.notify(this.getSnapshot());
  }
}
