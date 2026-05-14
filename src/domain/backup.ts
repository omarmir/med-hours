import { NewTimeBlock, TimeBlock, TimeBlockSource, TimeBlockType, minutesBetween } from './time';

export const BACKUP_FORMAT = 'med-hours.backup';
export const BACKUP_VERSION = 1;
export const BACKUP_FILE_PREFIX = 'med-hours-backup-';
export const BACKUP_FILE_EXTENSION = '.json';

export type BackupBlock = NewTimeBlock & {
  createdAt?: string;
  updatedAt?: string;
};

export type BackupSnapshot = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  app: {
    name: string;
    version?: string;
  };
  database: {
    userVersion: number;
  };
  blocks: BackupBlock[];
};

export type BackupSnapshotInput = {
  appName: string;
  appVersion?: string;
  blocks: TimeBlock[];
  databaseUserVersion: number;
  exportedAt?: Date;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertIsoDate(value: string, label: string) {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid ISO date.`);
  }
}

function assertBlockType(value: unknown): asserts value is TimeBlockType {
  if (value !== 'direct' && value !== 'indirect') {
    throw new Error('Block type must be direct or indirect.');
  }
}

function assertBlockSource(value: unknown): asserts value is TimeBlockSource {
  if (value !== 'manual' && value !== 'timer') {
    throw new Error('Block source must be manual or timer.');
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }

  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function hashString(input: string) {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }

  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);

  const high = (second >>> 0).toString(16).padStart(8, '0');
  const low = (first >>> 0).toString(16).padStart(8, '0');
  return `${high}${low}`;
}

export function backupFileName(exportedAt = new Date()) {
  return `${BACKUP_FILE_PREFIX}${exportedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}${BACKUP_FILE_EXTENSION}`;
}

export function createBackupSnapshot({
  appName,
  appVersion,
  blocks,
  databaseUserVersion,
  exportedAt = new Date(),
}: BackupSnapshotInput): BackupSnapshot {
  const sortedBlocks = [...blocks]
    .sort((first, second) =>
      `${first.workDate}|${first.startAt}|${first.endAt}|${first.blockType}|${first.source}`.localeCompare(
        `${second.workDate}|${second.startAt}|${second.endAt}|${second.blockType}|${second.source}`,
      ),
    )
    .map<BackupBlock>((block) => ({
      workDate: block.workDate,
      startAt: block.startAt,
      endAt: block.endAt,
      durationMinutes: block.durationMinutes,
      blockType: block.blockType,
      source: block.source,
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
    }));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    app: {
      name: appName,
      version: appVersion,
    },
    database: {
      userVersion: databaseUserVersion,
    },
    blocks: sortedBlocks,
  };
}

export function parseBackupSnapshot(json: string) {
  try {
    return validateBackupSnapshot(JSON.parse(json));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Backup file is not valid JSON.');
    }

    throw error;
  }
}

export function validateBackupSnapshot(value: unknown): BackupSnapshot {
  assertObject(value, 'Backup');

  if (value.format !== BACKUP_FORMAT) {
    throw new Error('Backup format is not supported.');
  }

  if (value.version !== BACKUP_VERSION) {
    throw new Error('Backup version is not supported.');
  }

  assertString(value.exportedAt, 'Exported timestamp');
  assertIsoDate(value.exportedAt, 'Exported timestamp');
  assertObject(value.app, 'App metadata');
  assertString(value.app.name, 'App name');
  assertObject(value.database, 'Database metadata');

  const databaseUserVersion = value.database.userVersion;

  if (
    typeof databaseUserVersion !== 'number' ||
    !Number.isInteger(databaseUserVersion) ||
    databaseUserVersion < 0
  ) {
    throw new Error('Database user version must be a non-negative integer.');
  }

  if (!Array.isArray(value.blocks)) {
    throw new Error('Backup blocks must be an array.');
  }

  const blocks = value.blocks.map((rawBlock, index): BackupBlock => {
    assertObject(rawBlock, `Backup block ${index + 1}`);
    assertString(rawBlock.workDate, `Backup block ${index + 1} work date`);

    if (!DATE_KEY_PATTERN.test(rawBlock.workDate)) {
      throw new Error(`Backup block ${index + 1} work date is invalid.`);
    }

    assertString(rawBlock.startAt, `Backup block ${index + 1} start`);
    assertString(rawBlock.endAt, `Backup block ${index + 1} end`);
    assertIsoDate(rawBlock.startAt, `Backup block ${index + 1} start`);
    assertIsoDate(rawBlock.endAt, `Backup block ${index + 1} end`);
    assertBlockType(rawBlock.blockType);
    assertBlockSource(rawBlock.source);

    const durationMinutes = rawBlock.durationMinutes;

    if (
      typeof durationMinutes !== 'number' ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 0
    ) {
      throw new Error(`Backup block ${index + 1} duration must be a non-negative integer.`);
    }

    if (new Date(rawBlock.endAt) <= new Date(rawBlock.startAt)) {
      throw new Error(`Backup block ${index + 1} end must be after start.`);
    }

    if (minutesBetween(rawBlock.startAt, rawBlock.endAt) !== durationMinutes) {
      throw new Error(`Backup block ${index + 1} duration does not match start and end.`);
    }

    if (rawBlock.createdAt !== undefined) {
      assertString(rawBlock.createdAt, `Backup block ${index + 1} created timestamp`);
      assertIsoDate(rawBlock.createdAt, `Backup block ${index + 1} created timestamp`);
    }

    if (rawBlock.updatedAt !== undefined) {
      assertString(rawBlock.updatedAt, `Backup block ${index + 1} updated timestamp`);
      assertIsoDate(rawBlock.updatedAt, `Backup block ${index + 1} updated timestamp`);
    }

    return {
      workDate: rawBlock.workDate,
      startAt: rawBlock.startAt,
      endAt: rawBlock.endAt,
      durationMinutes,
      blockType: rawBlock.blockType,
      source: rawBlock.source,
      createdAt: rawBlock.createdAt,
      updatedAt: rawBlock.updatedAt,
    };
  });

  const sortedForOverlap = [...blocks].sort((first, second) =>
    `${first.workDate}|${first.startAt}|${first.endAt}`.localeCompare(
      `${second.workDate}|${second.startAt}|${second.endAt}`,
    ),
  );

  for (let index = 1; index < sortedForOverlap.length; index += 1) {
    const previous = sortedForOverlap[index - 1];
    const current = sortedForOverlap[index];

    if (previous.workDate === current.workDate && previous.endAt > current.startAt) {
      throw new Error('Backup contains overlapping time blocks.');
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: value.exportedAt,
    app: {
      name: value.app.name,
      version: typeof value.app.version === 'string' ? value.app.version : undefined,
    },
    database: {
      userVersion: databaseUserVersion,
    },
    blocks,
  };
}

export function fingerprintBackupBlocks(blocks: BackupBlock[]) {
  const normalizedBlocks = [...blocks]
    .sort((first, second) =>
      `${first.workDate}|${first.startAt}|${first.endAt}|${first.blockType}|${first.source}`.localeCompare(
        `${second.workDate}|${second.startAt}|${second.endAt}|${second.blockType}|${second.source}`,
      ),
    )
    .map((block) => ({
      workDate: block.workDate,
      startAt: block.startAt,
      endAt: block.endAt,
      durationMinutes: block.durationMinutes,
      blockType: block.blockType,
      source: block.source,
    }));

  return hashString(stableJson(normalizedBlocks));
}

export function fingerprintBackupSnapshot(snapshot: BackupSnapshot) {
  return fingerprintBackupBlocks(snapshot.blocks);
}
