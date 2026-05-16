import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
} from 'react';
import Constants from 'expo-constants';

import {
  BackupManager,
  BackupRestorePreview,
  BackupStatusSnapshot,
} from '@/storage/backup-manager';
import { ActiveTimer, NewTimeBlock, TimeBlock, TimeBlockType } from '@/domain/time';
import { TimeRepository, openMedHoursDatabase } from '@/storage/database';
import { DriveBackupFile, GoogleDriveBackupClient } from '@/storage/google-drive-backup';

type TimeStoreContextValue = {
  activeTimer: ActiveTimer | null;
  backup: BackupStatusSnapshot;
  blocks: TimeBlock[];
  error: string | null;
  isReady: boolean;
  isBusy: boolean;
  isBackupBusy: boolean;
  refresh: () => Promise<void>;
  clearError: () => void;
  connectBackup: () => Promise<void>;
  signOutBackup: () => Promise<void>;
  refreshBackups: () => Promise<void>;
  backupNow: () => Promise<void>;
  previewRestoreBackup: (file: DriveBackupFile) => Promise<BackupRestorePreview>;
  restoreBackup: (preview: BackupRestorePreview) => Promise<void>;
  addManualBlock: (block: NewTimeBlock) => Promise<void>;
  updateBlock: (id: number, block: NewTimeBlock) => Promise<void>;
  deleteBlock: (id: number) => Promise<void>;
  startTimer: () => Promise<void>;
  pauseTimer: () => Promise<void>;
  resumeTimer: () => Promise<void>;
  stopTimer: (blockType?: TimeBlockType) => Promise<void>;
  cancelTimer: () => Promise<void>;
};

const TimeStoreContext = createContext<TimeStoreContextValue | undefined>(undefined);
const initialBackupStatus: BackupStatusSnapshot = {
  status: 'idle',
  backupState: null,
  files: [],
  isConnected: false,
  userEmail: null,
  userName: null,
  error: null,
};

export function TimeStoreProvider({ children }: PropsWithChildren) {
  const [repository, setRepository] = useState<TimeRepository | null>(null);
  const [backupManager, setBackupManager] = useState<BackupManager | null>(null);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [backup, setBackup] = useState<BackupStatusSnapshot>(initialBackupStatus);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const backupManagerRef = useRef<BackupManager | null>(null);

  const refresh = useCallback(async () => {
    if (!repository) {
      return;
    }

    const [nextBlocks, nextActiveTimer] = await Promise.all([
      repository.listBlocks(),
      repository.getActiveTimer(),
    ]);
    setBlocks(nextBlocks);
    setActiveTimer(nextActiveTimer);
  }, [repository]);

  useEffect(() => {
    let isMounted = true;

    async function initialize() {
      try {
        const db = await openMedHoursDatabase();
        if (isMounted) {
          const nextRepository = new TimeRepository(db);
          const nextBackupManager = new BackupManager(
            nextRepository,
            new GoogleDriveBackupClient(),
            (status) => {
              if (isMounted) {
                setBackup(status);
              }
            },
            undefined,
            {
              appName: Constants.expoConfig?.name ?? 'Med Hours',
              appVersion:
                Constants.expoConfig?.version ?? Constants.expoConfig?.runtimeVersion?.toString(),
            },
          );
          backupManagerRef.current = nextBackupManager;
          setRepository(nextRepository);
          setBackupManager(nextBackupManager);
          await nextBackupManager.initialize();
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Database failed to open.');
        }
      }
    }

    initialize();

    return () => {
      isMounted = false;
      backupManagerRef.current?.dispose();
      backupManagerRef.current = null;
    };
  }, []);

  useEffect(() => {
    refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Time entries failed to load.');
    });
  }, [refresh]);

  const runMutation = useCallback(
    async (mutation: (repo: TimeRepository) => Promise<void>, queueBackup = false) => {
      if (!repository) {
        setError('Database is still starting.');
        return;
      }

      setIsBusy(true);
      setError(null);
      try {
        await mutation(repository);
        await refresh();
        if (queueBackup) {
          backupManagerRef.current?.queueAutoBackup();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The time entry could not be saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh, repository],
  );

  const runBackupAction = useCallback(
    async <Result,>(action: (manager: BackupManager) => Promise<Result>) => {
      if (!backupManager) {
        setError('Backup is still starting.');
        throw new Error('Backup is still starting.');
      }

      setIsBackupBusy(true);
      setError(null);
      try {
        return await action(backupManager);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Backup action failed.';
        setError(message);
        throw err;
      } finally {
        setIsBackupBusy(false);
      }
    },
    [backupManager],
  );

  const value = useMemo<TimeStoreContextValue>(
    () => ({
      activeTimer,
      backup,
      blocks,
      error,
      isReady: Boolean(repository),
      isBusy,
      isBackupBusy,
      refresh,
      clearError: () => setError(null),
      connectBackup: () => runBackupAction((manager) => manager.connect()),
      signOutBackup: () => runBackupAction((manager) => manager.signOut()),
      refreshBackups: () => runBackupAction((manager) => manager.refreshFiles()),
      backupNow: () => runBackupAction((manager) => manager.backupNow()),
      previewRestoreBackup: (file) => runBackupAction((manager) => manager.previewRestore(file)),
      restoreBackup: (preview) =>
        runBackupAction(async (manager) => {
          await manager.restore(preview);
          await refresh();
        }),
      addManualBlock: (block) => runMutation((repo) => repo.addManualBlock(block), true),
      updateBlock: (id, block) =>
        runMutation((repo) => repo.updateBlock(id, block), true),
      deleteBlock: (id) => runMutation((repo) => repo.deleteBlock(id), true),
      startTimer: () => runMutation((repo) => repo.startTimer()),
      pauseTimer: () => runMutation((repo) => repo.pauseTimer()),
      resumeTimer: () => runMutation((repo) => repo.resumeTimer()),
      stopTimer: (blockType = 'direct') => runMutation((repo) => repo.stopTimer(blockType), true),
      cancelTimer: () => runMutation((repo) => repo.cancelTimer()),
    }),
    [
      activeTimer,
      backup,
      blocks,
      error,
      isBackupBusy,
      isBusy,
      refresh,
      repository,
      runBackupAction,
      runMutation,
    ],
  );

  return <TimeStoreContext.Provider value={value}>{children}</TimeStoreContext.Provider>;
}

export function useTimeStore() {
  const value = useContext(TimeStoreContext);

  if (!value) {
    throw new Error('useTimeStore must be used inside TimeStoreProvider.');
  }

  return value;
}
