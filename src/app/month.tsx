import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  Divider,
  IconButton,
  Snackbar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';

import {
  formatDateKey,
  formatDuration,
  formatReadableDate,
  formatReadableMonth,
  parseDateKey,
  summarizeMonth,
} from '@/domain/time';
import { useTimeStore } from '@/storage/time-store';

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export default function MonthScreen() {
  const theme = useTheme();
  const { blocks, error, isReady, refresh, clearError } = useTimeStore();
  const [monthDate, setMonthDate] = useState(monthStart(new Date()));

  const directBlocks = useMemo(
    () => blocks.filter((block) => block.blockType === 'direct'),
    [blocks],
  );
  const indirectBlocks = useMemo(
    () => blocks.filter((block) => block.blockType === 'indirect'),
    [blocks],
  );
  const summary = useMemo(() => summarizeMonth(monthDate, directBlocks), [directBlocks, monthDate]);
  const indirectSummary = useMemo(
    () => summarizeMonth(monthDate, indirectBlocks),
    [indirectBlocks, monthDate],
  );
  const dailySummaries = useMemo(() => {
    const dates = Array.from(
      new Set([
        ...summary.days.map((day) => day.workDate),
        ...indirectSummary.days.map((day) => day.workDate),
      ]),
    ).sort();

    return dates.map((workDate) => ({
      workDate,
      direct: summary.days.find((day) => day.workDate === workDate) ?? {
        workDate,
        minutes: 0,
        directUnits: 0,
      },
      indirect: indirectSummary.days.find((day) => day.workDate === workDate) ?? {
        workDate,
        minutes: 0,
        directUnits: 0,
      },
    }));
  }, [indirectSummary.days, summary.days]);
  const indirectUnitDelta = indirectSummary.directUnits - summary.indirectUnits;
  const indirectDeltaLabel =
    indirectUnitDelta > 0
      ? `${indirectUnitDelta} over`
      : `${Math.abs(indirectUnitDelta)} under`;
  const isOverIndirectCap = indirectUnitDelta > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={!isReady} onRefresh={refresh} />}>
        <View style={styles.header}>
          <View>
            <Text variant="headlineMedium">Month</Text>
            <Text variant="bodyMedium" style={styles.muted}>
              {formatReadableMonth(monthDate)}
            </Text>
          </View>
          <Button mode="outlined" compact onPress={() => setMonthDate(monthStart(new Date()))}>
            Current
          </Button>
        </View>

        <Surface elevation={1} style={styles.monthRail}>
          <IconButton icon="chevron-left" onPress={() => setMonthDate(shiftMonth(monthDate, -1))} />
          <Text variant="titleMedium">{formatReadableMonth(monthDate)}</Text>
          <IconButton icon="chevron-right" onPress={() => setMonthDate(shiftMonth(monthDate, 1))} />
        </Surface>

        <View style={styles.summaryGrid}>
          <Surface elevation={1} style={styles.summaryTile}>
            <Text variant="labelMedium" style={styles.muted}>
              Direct hours
            </Text>
            <Text variant="headlineSmall">{(summary.directMinutes / 60).toFixed(2)}</Text>
          </Surface>
          <Surface elevation={1} style={styles.summaryTile}>
            <Text variant="labelMedium" style={styles.muted}>
              Direct units
            </Text>
            <Text variant="headlineSmall">{summary.directUnits}</Text>
          </Surface>
          <Surface
            elevation={1}
            style={[styles.summaryTile, isOverIndirectCap && styles.warningSummaryTile]}>
            <Text
              variant="labelMedium"
              style={[styles.muted, isOverIndirectCap && styles.warningLabel]}>
              Indirect
            </Text>
            <Text variant="headlineSmall" style={isOverIndirectCap && styles.warningText}>
              {indirectSummary.directUnits}
            </Text>
          </Surface>
        </View>

        <Card mode="contained" style={styles.capCard}>
          <Card.Content style={styles.capContent}>
            <View>
              <Text variant="titleMedium">Indirect cap</Text>
              <Text variant="bodyMedium" style={styles.muted}>
                Raw direct minutes x 0.3333, floored to full units.
              </Text>
            </View>
            <Divider />
            <View style={styles.capRows}>
              <View style={styles.capRow}>
                <Text variant="bodyMedium">Cap minutes</Text>
                <Text variant="titleMedium">{summary.indirectCapMinutes.toFixed(1)}</Text>
              </View>
              <View style={styles.capRow}>
                <Text variant="bodyMedium">Recommended indirect units</Text>
                <Text variant="titleMedium">{summary.indirectUnits}</Text>
              </View>
              <View style={styles.capRow}>
                <Text variant="bodyMedium">Actual indirect units</Text>
                <Text variant="titleMedium">{indirectSummary.directUnits}</Text>
              </View>
              <View
                style={[styles.capDeltaBadge, isOverIndirectCap && styles.capDeltaBadgeWarning]}>
                <Text
                  variant="labelLarge"
                  style={[styles.capDeltaText, isOverIndirectCap && styles.capDeltaTextWarning]}>
                  {indirectDeltaLabel}
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>

        <View style={styles.sectionHeader}>
          <Text variant="titleLarge">Daily summaries</Text>
        </View>

        {dailySummaries.length === 0 ? (
          <Surface elevation={0} style={styles.emptyState}>
            <Text variant="titleMedium">No time this month</Text>
            <Text variant="bodyMedium" style={styles.muted}>
              Monthly totals update as daily blocks are recorded.
            </Text>
          </Surface>
        ) : (
          <View style={styles.dayList}>
            {dailySummaries.map((day) => (
              <Card key={day.workDate} mode="outlined" style={styles.dayCard}>
                <Card.Content style={styles.dayContent}>
                  <View style={styles.dayDate}>
                    <Text variant="titleMedium">{formatReadableDate(day.workDate)}</Text>
                    <Text variant="bodyMedium" style={styles.muted}>
                      {formatDateKey(parseDateKey(day.workDate))}
                    </Text>
                  </View>
                  <View style={styles.dayBreakdown}>
                    <View style={styles.dayMetric}>
                      <Text variant="labelMedium" style={styles.muted}>
                        Direct
                      </Text>
                      <Text variant="titleSmall">{day.direct.directUnits} units</Text>
                      <Text variant="bodySmall" style={styles.muted}>
                        {formatDuration(day.direct.minutes)}
                      </Text>
                    </View>
                    <View style={styles.dayMetric}>
                      <Text variant="labelMedium" style={styles.muted}>
                        Indirect
                      </Text>
                      <Text variant="titleSmall">{day.indirect.directUnits} units</Text>
                      <Text variant="bodySmall" style={styles.muted}>
                        {formatDuration(day.indirect.minutes)}
                      </Text>
                    </View>
                  </View>
                </Card.Content>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      <Snackbar visible={Boolean(error)} onDismiss={clearError}>
        {error}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 16,
    paddingBottom: 96,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  muted: {
    opacity: 0.68,
  },
  monthRail: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryTile: {
    borderRadius: 8,
    flex: 1,
    gap: 6,
    padding: 16,
  },
  warningSummaryTile: {
    backgroundColor: '#ffe7a3',
  },
  warningLabel: {
    color: '#4f3100',
    opacity: 1,
  },
  warningText: {
    color: '#4f3100',
  },
  capCard: {
    borderRadius: 8,
  },
  capContent: {
    gap: 14,
  },
  capRows: {
    gap: 8,
  },
  capRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  capDeltaBadge: {
    alignSelf: 'flex-end',
    backgroundColor: '#e7eee9',
    borderColor: '#5f6f66',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  capDeltaBadgeWarning: {
    backgroundColor: '#ffe7a3',
    borderColor: '#7a4b00',
  },
  capDeltaText: {
    color: '#1d2b23',
    fontWeight: '700',
  },
  capDeltaTextWarning: {
    color: '#4f3100',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  emptyState: {
    borderRadius: 8,
    gap: 6,
    padding: 18,
  },
  dayList: {
    gap: 10,
  },
  dayCard: {
    borderRadius: 8,
  },
  dayContent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  dayDate: {
    flex: 1,
    minWidth: 0,
  },
  dayBreakdown: {
    flexDirection: 'row',
    gap: 16,
  },
  dayMetric: {
    alignItems: 'flex-end',
    minWidth: 58,
  },
});
