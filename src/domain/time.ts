export type TimeBlockSource = 'manual' | 'timer';
export type TimeBlockType = 'direct' | 'indirect';

export type TimeBlock = {
  id: number;
  workDate: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  blockType: TimeBlockType;
  source: TimeBlockSource;
  createdAt: string;
  updatedAt: string;
};

export type NewTimeBlock = {
  workDate: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  blockType: TimeBlockType;
  source: TimeBlockSource;
};

export type ActiveTimer = {
  id: number;
  startAt: string;
  pausedAt: string | null;
  pauses: TimerPause[];
  createdAt: string;
};

export type TimerPause = {
  id: number;
  startAt: string;
  endAt: string | null;
};

export type DailySummary = {
  workDate: string;
  minutes: number;
  directUnits: number;
};

export type MonthlySummary = {
  monthKey: string;
  directMinutes: number;
  directUnits: number;
  indirectCapMinutes: number;
  indirectUnits: number;
  days: DailySummary[];
};

const MINUTE_MS = 60_000;

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatMonthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function combineDateAndTime(workDate: string, time: Date) {
  const date = parseDateKey(workDate);
  date.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return date;
}

export function toIsoMinute(date: Date) {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy.toISOString();
}

export function minutesBetween(startAt: string | Date, endAt: string | Date) {
  const start = typeof startAt === 'string' ? new Date(startAt) : startAt;
  const end = typeof endAt === 'string' ? new Date(endAt) : endAt;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MINUTE_MS));
}

export function createManualBlockInput(
  workDate: string,
  startTime: Date,
  endTime: Date,
  blockType: TimeBlockType = 'direct',
): NewTimeBlock {
  const start = combineDateAndTime(workDate, startTime);
  const end = combineDateAndTime(workDate, endTime);

  if (end <= start) {
    throw new Error('End time must be after start time.');
  }

  return {
    workDate,
    startAt: toIsoMinute(start),
    endAt: toIsoMinute(end),
    durationMinutes: minutesBetween(start, end),
    blockType,
    source: 'manual',
  };
}

export function hasOverlap(
  candidate: Pick<TimeBlock, 'startAt' | 'endAt' | 'workDate'>,
  existing: Pick<TimeBlock, 'id' | 'startAt' | 'endAt' | 'workDate'>[],
  ignoreId?: number,
) {
  return existing.some((block) => {
    if (block.workDate !== candidate.workDate || block.id === ignoreId) {
      return false;
    }

    return candidate.startAt < block.endAt && candidate.endAt > block.startAt;
  });
}

export function roundDailyDirectUnits(minutes: number) {
  const wholeUnits = Math.floor(minutes / 15);
  const remainder = minutes % 15;
  return wholeUnits + (remainder >= 8 ? 1 : 0);
}

export function indirectCapMinutes(rawDirectMinutes: number) {
  return rawDirectMinutes * 0.3333;
}

export function claimableIndirectUnits(rawDirectMinutes: number) {
  return Math.floor(indirectCapMinutes(rawDirectMinutes) / 15);
}

export function splitTimerIntoBlocks(
  startAt: Date,
  endAt: Date,
  blockType: TimeBlockType = 'direct',
): NewTimeBlock[] {
  if (endAt <= startAt) {
    throw new Error('Timer stop time must be after start time.');
  }

  const blocks: NewTimeBlock[] = [];
  let cursor = new Date(startAt);

  while (cursor < endAt) {
    const workDate = formatDateKey(cursor);
    const midnight = parseDateKey(workDate);
    midnight.setDate(midnight.getDate() + 1);
    const segmentEnd = midnight < endAt ? midnight : endAt;
    const durationMinutes = minutesBetween(cursor, segmentEnd);

    if (durationMinutes > 0) {
      blocks.push({
        workDate,
        startAt: toIsoMinute(cursor),
        endAt: toIsoMinute(segmentEnd),
        durationMinutes,
        blockType,
        source: 'timer',
      });
    }

    cursor = new Date(segmentEnd);
  }

  return blocks;
}

export function splitTimerIntoBlocksExcludingPauses(
  startAt: Date,
  endAt: Date,
  pauses: Pick<TimerPause, 'startAt' | 'endAt'>[],
  blockType: TimeBlockType = 'direct',
): NewTimeBlock[] {
  if (endAt <= startAt) {
    throw new Error('Timer stop time must be after start time.');
  }

  const blocks: NewTimeBlock[] = [];
  let cursor = new Date(startAt);

  const sortedPauses = [...pauses].sort((first, second) =>
    first.startAt.localeCompare(second.startAt),
  );

  for (const pause of sortedPauses) {
    const pauseStart = new Date(pause.startAt);
    const pauseEnd = pause.endAt ? new Date(pause.endAt) : endAt;

    if (pauseStart >= endAt) {
      break;
    }

    if (pauseStart > cursor) {
      blocks.push(
        ...splitTimerIntoBlocks(cursor, pauseStart < endAt ? pauseStart : endAt, blockType),
      );
    }

    if (pauseEnd > cursor) {
      cursor = pauseEnd > endAt ? endAt : pauseEnd;
    }
  }

  if (cursor < endAt) {
    blocks.push(...splitTimerIntoBlocks(cursor, endAt, blockType));
  }

  return blocks;
}

export function activeTimerElapsedMinutes(timer: ActiveTimer, now = new Date()) {
  const effectiveEnd = timer.pausedAt ? new Date(timer.pausedAt) : now;

  if (effectiveEnd <= new Date(timer.startAt)) {
    return 0;
  }

  return splitTimerIntoBlocksExcludingPauses(new Date(timer.startAt), effectiveEnd, timer.pauses)
    .reduce((total, block) => total + block.durationMinutes, 0);
}

export function summarizeDay(workDate: string, blocks: Pick<TimeBlock, 'workDate' | 'durationMinutes'>[]) {
  const minutes = blocks
    .filter((block) => block.workDate === workDate)
    .reduce((total, block) => total + block.durationMinutes, 0);

  return {
    workDate,
    minutes,
    directUnits: roundDailyDirectUnits(minutes),
  };
}

export function summarizeMonth(monthDate: Date, blocks: TimeBlock[]): MonthlySummary {
  const monthKey = formatMonthKey(monthDate);
  const monthBlocks = blocks.filter((block) => block.workDate.startsWith(monthKey));
  const dates = Array.from(new Set(monthBlocks.map((block) => block.workDate))).sort();
  const days = dates.map((workDate) => summarizeDay(workDate, monthBlocks));
  const directMinutes = days.reduce((total, day) => total + day.minutes, 0);
  const directUnits = days.reduce((total, day) => total + day.directUnits, 0);

  return {
    monthKey,
    directMinutes,
    directUnits,
    indirectCapMinutes: indirectCapMinutes(directMinutes),
    indirectUnits: claimableIndirectUnits(directMinutes),
    days,
  };
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}m`;
  }

  if (mins === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${mins}m`;
}

export function formatClockTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(/\s?a\.?m\.?$/i, 'a')
    .replace(/\s?p\.?m\.?$/i, 'p');
}

export function formatReadableDate(dateKey: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseDateKey(dateKey));
}

export function formatReadableMonth(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(date);
}
