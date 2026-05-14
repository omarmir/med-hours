import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ActiveTimer, NewTimeBlock, TimeBlock } from '@/domain/time';
import { TimeRepository, openMedHoursDatabase } from '@/storage/database';

type TimeStoreContextValue = {
  activeTimer: ActiveTimer | null;
  blocks: TimeBlock[];
  error: string | null;
  isReady: boolean;
  isBusy: boolean;
  refresh: () => Promise<void>;
  clearError: () => void;
  addManualBlock: (block: NewTimeBlock) => Promise<void>;
  updateManualBlock: (id: number, block: NewTimeBlock) => Promise<void>;
  deleteBlock: (id: number) => Promise<void>;
  startTimer: () => Promise<void>;
  pauseTimer: () => Promise<void>;
  resumeTimer: () => Promise<void>;
  stopTimer: () => Promise<void>;
  cancelTimer: () => Promise<void>;
};

const TimeStoreContext = createContext<TimeStoreContextValue | undefined>(undefined);

export function TimeStoreProvider({ children }: PropsWithChildren) {
  const [repository, setRepository] = useState<TimeRepository | null>(null);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

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
          setRepository(new TimeRepository(db));
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
    };
  }, []);

  useEffect(() => {
    refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Time entries failed to load.');
    });
  }, [refresh]);

  const runMutation = useCallback(
    async (mutation: (repo: TimeRepository) => Promise<void>) => {
      if (!repository) {
        setError('Database is still starting.');
        return;
      }

      setIsBusy(true);
      setError(null);
      try {
        await mutation(repository);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The time entry could not be saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh, repository],
  );

  const value = useMemo<TimeStoreContextValue>(
    () => ({
      activeTimer,
      blocks,
      error,
      isReady: Boolean(repository),
      isBusy,
      refresh,
      clearError: () => setError(null),
      addManualBlock: (block) => runMutation((repo) => repo.addManualBlock(block)),
      updateManualBlock: (id, block) => runMutation((repo) => repo.updateManualBlock(id, block)),
      deleteBlock: (id) => runMutation((repo) => repo.deleteBlock(id)),
      startTimer: () => runMutation((repo) => repo.startTimer()),
      pauseTimer: () => runMutation((repo) => repo.pauseTimer()),
      resumeTimer: () => runMutation((repo) => repo.resumeTimer()),
      stopTimer: () => runMutation((repo) => repo.stopTimer()),
      cancelTimer: () => runMutation((repo) => repo.cancelTimer()),
    }),
    [activeTimer, blocks, error, isBusy, refresh, repository, runMutation],
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
