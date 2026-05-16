import { describe, expect, it } from 'vitest';

import {
  activeTimerElapsedMinutes,
  claimableIndirectUnits,
  createManualBlockInput,
  hasOverlap,
  indirectCapMinutes,
  roundDailyDirectUnits,
  splitTimerIntoBlocksExcludingPauses,
  splitTimerIntoBlocks,
  summarizeMonth,
} from './time';

describe('billing time rules', () => {
  it('rounds daily direct units from the daily total', () => {
    expect(roundDailyDirectUnits(7)).toBe(0);
    expect(roundDailyDirectUnits(8)).toBe(1);
    expect(roundDailyDirectUnits(22)).toBe(1);
    expect(roundDailyDirectUnits(23)).toBe(2);
    expect(roundDailyDirectUnits(30)).toBe(2);
  });

  it('floors indirect units so the monthly cap is never exceeded', () => {
    expect(indirectCapMinutes(120)).toBeCloseTo(39.996);
    expect(claimableIndirectUnits(120)).toBe(2);
    expect(claimableIndirectUnits(135)).toBe(2);
    expect(claimableIndirectUnits(180)).toBe(3);
  });

  it('detects overlapping same-day blocks and ignores other dates', () => {
    const existing = [
      {
        id: 1,
        workDate: '2026-05-13',
        startAt: '2026-05-13T13:00:00.000Z',
        endAt: '2026-05-13T14:00:00.000Z',
      },
      {
        id: 2,
        workDate: '2026-05-14',
        startAt: '2026-05-14T13:15:00.000Z',
        endAt: '2026-05-14T13:45:00.000Z',
      },
    ];

    expect(
      hasOverlap(
        {
          workDate: '2026-05-13',
          startAt: '2026-05-13T13:30:00.000Z',
          endAt: '2026-05-13T14:30:00.000Z',
        },
        existing,
      ),
    ).toBe(true);
    expect(
      hasOverlap(
        {
          workDate: '2026-05-13',
          startAt: '2026-05-13T14:00:00.000Z',
          endAt: '2026-05-13T14:30:00.000Z',
        },
        existing,
      ),
    ).toBe(false);
  });

  it('rejects manual blocks where the end time is not after the start time', () => {
    const start = new Date(2026, 4, 13, 14, 0);
    const end = new Date(2026, 4, 13, 13, 30);

    expect(() => createManualBlockInput('2026-05-13', start, end)).toThrow(
      'End time must be after start time.',
    );
  });

  it('creates manual blocks with direct or indirect type', () => {
    const start = new Date(2026, 4, 13, 13, 0);
    const end = new Date(2026, 4, 13, 13, 45);

    expect(createManualBlockInput('2026-05-13', start, end)).toMatchObject({
      blockType: 'direct',
      durationMinutes: 45,
    });
    expect(createManualBlockInput('2026-05-13', start, end, 'indirect')).toMatchObject({
      blockType: 'indirect',
      durationMinutes: 45,
    });
  });


  it('splits timer entries across midnight', () => {
    const blocks = splitTimerIntoBlocks(
      new Date(2026, 4, 13, 23, 45),
      new Date(2026, 4, 14, 0, 30),
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ workDate: '2026-05-13', durationMinutes: 15 });
    expect(blocks[1]).toMatchObject({ workDate: '2026-05-14', durationMinutes: 30 });
  });

  it('splits timer entries with the selected block type', () => {
    const blocks = splitTimerIntoBlocks(
      new Date(2026, 4, 13, 23, 45),
      new Date(2026, 4, 14, 0, 30),
      'indirect',
    );

    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.blockType === 'indirect')).toBe(true);
    expect(blocks.every((block) => block.source === 'timer')).toBe(true);
  });

  it('excludes paused intervals from timer blocks', () => {
    const blocks = splitTimerIntoBlocksExcludingPauses(
      new Date(2026, 4, 13, 9, 0),
      new Date(2026, 4, 13, 10, 0),
      [{ startAt: new Date(2026, 4, 13, 9, 20).toISOString(), endAt: new Date(2026, 4, 13, 9, 40).toISOString() }],
    );

    expect(blocks.map((block) => block.durationMinutes)).toEqual([20, 20]);
  });

  it('freezes elapsed time while a timer is paused', () => {
    const startAt = new Date(2026, 4, 13, 9, 0).toISOString();
    const pausedAt = new Date(2026, 4, 13, 9, 20).toISOString();

    expect(
      activeTimerElapsedMinutes(
        {
          id: 1,
          startAt,
          pausedAt,
          pauses: [{ id: 1, startAt: pausedAt, endAt: null }],
          createdAt: startAt,
        },
        new Date(2026, 4, 13, 10, 0),
      ),
    ).toBe(20);
  });


  it('sums monthly direct units from daily rounded totals', () => {
    const summary = summarizeMonth(new Date(2026, 4, 1), [
      {
        id: 1,
        workDate: '2026-05-13',
        startAt: '2026-05-13T13:00:00.000Z',
        endAt: '2026-05-13T13:07:00.000Z',
        durationMinutes: 7,
        blockType: 'direct',
        source: 'manual',
        createdAt: '2026-05-13T13:00:00.000Z',
        updatedAt: '2026-05-13T13:00:00.000Z',
      },
      {
        id: 2,
        workDate: '2026-05-13',
        startAt: '2026-05-13T14:00:00.000Z',
        endAt: '2026-05-13T14:08:00.000Z',
        durationMinutes: 8,
        blockType: 'direct',
        source: 'manual',
        createdAt: '2026-05-13T14:00:00.000Z',
        updatedAt: '2026-05-13T14:00:00.000Z',
      },
      {
        id: 3,
        workDate: '2026-05-14',
        startAt: '2026-05-14T14:00:00.000Z',
        endAt: '2026-05-14T14:08:00.000Z',
        durationMinutes: 8,
        blockType: 'direct',
        source: 'manual',
        createdAt: '2026-05-14T14:00:00.000Z',
        updatedAt: '2026-05-14T14:00:00.000Z',
      },
    ]);

    expect(summary.directMinutes).toBe(23);
    expect(summary.directUnits).toBe(2);
    expect(summary.days).toEqual([
      { workDate: '2026-05-13', minutes: 15, directUnits: 1 },
      { workDate: '2026-05-14', minutes: 8, directUnits: 1 },
    ]);
  });
});
