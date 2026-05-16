import React, { useMemo, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  IconButton,
  Modal,
  Portal,
  SegmentedButtons,
  Snackbar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';

import { BlockEditor } from '@/components/time/block-editor';
import {
  TimeBlock,
  TimeBlockType,
  activeTimerElapsedMinutes,
  claimableIndirectUnits,
  formatClockTime,
  formatDateKey,
  formatDuration,
  formatReadableDate,
  parseDateKey,
  summarizeDay,
} from '@/domain/time';
import { useTimeStore } from '@/storage/time-store';

function shiftDate(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

export default function TodayScreen() {
  const theme = useTheme();
  const {
    activeTimer,
    blocks,
    error,
    isBusy,
    isReady,
    refresh,
    clearError,
    addManualBlock,
    updateBlock,
    deleteBlock,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    cancelTimer,
  } = useTimeStore();
  const [selectedDate, setSelectedDate] = useState(formatDateKey(new Date()));
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingBlock, setEditingBlock] = useState<TimeBlock | null>(null);
  const [stopTypeVisible, setStopTypeVisible] = useState(false);
  const [timerStopType, setTimerStopType] = useState<TimeBlockType>('direct');
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  const refreshTimerDisplay = React.useCallback(() => {
    setElapsedMinutes(activeTimer ? activeTimerElapsedMinutes(activeTimer) : 0);
  }, [activeTimer]);

  React.useEffect(() => {
    refreshTimerDisplay();

    if (!activeTimer) {
      return undefined;
    }

    const interval = setInterval(refreshTimerDisplay, 30_000);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshTimerDisplay();
        void refresh().catch(() => undefined);
      }
    });

    return () => {
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [activeTimer, refresh, refreshTimerDisplay]);

  const selectedBlocks = useMemo(
    () =>
      blocks
        .filter((block) => block.workDate === selectedDate)
        .sort((first, second) => first.startAt.localeCompare(second.startAt)),
    [blocks, selectedDate],
  );
  const selectedDirectBlocks = useMemo(
    () => selectedBlocks.filter((block) => block.blockType === 'direct'),
    [selectedBlocks],
  );
  const selectedIndirectBlocks = useMemo(
    () => selectedBlocks.filter((block) => block.blockType === 'indirect'),
    [selectedBlocks],
  );
  const directSummary = useMemo(
    () => summarizeDay(selectedDate, selectedDirectBlocks),
    [selectedDate, selectedDirectBlocks],
  );
  const indirectSummary = useMemo(
    () => summarizeDay(selectedDate, selectedIndirectBlocks),
    [selectedDate, selectedIndirectBlocks],
  );
  const recommendedIndirectUnits = claimableIndirectUnits(directSummary.minutes);
  const openEditor = (block?: TimeBlock) => {
    setEditingBlock(block ?? null);
    setEditorVisible(true);
  };

  const openStopTypePicker = () => {
    setTimerStopType('direct');
    setStopTypeVisible(true);
  };

  const handleStopTimer = async () => {
    await stopTimer(timerStopType);
    setStopTypeVisible(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={!isReady} onRefresh={refresh} />}>
        <View style={styles.header}>
          <View>
            <Text variant="headlineMedium">Med Hours</Text>
            <Text variant="bodyMedium" style={styles.muted}>
              {formatReadableDate(selectedDate)}
            </Text>
          </View>
          <Button mode="outlined" compact onPress={() => setSelectedDate(formatDateKey(new Date()))}>
            Today
          </Button>
        </View>

        <Surface elevation={1} style={styles.dateRail}>
          <IconButton icon="chevron-left" onPress={() => setSelectedDate(shiftDate(selectedDate, -1))} />
          <Text variant="titleMedium">{formatReadableDate(selectedDate)}</Text>
          <IconButton icon="chevron-right" onPress={() => setSelectedDate(shiftDate(selectedDate, 1))} />
        </Surface>

        <Card mode="contained" style={styles.timerCard}>
          <Card.Content style={styles.timerContent}>
            <View>
              <Text variant="titleMedium">Active timer</Text>
              <Text variant="bodyMedium" style={styles.muted}>
                {activeTimer
                  ? `${activeTimer.pausedAt ? 'Paused' : 'Started'} ${formatClockTime(
                      activeTimer.pausedAt ?? activeTimer.startAt,
                    )}`
                  : 'No timer is running'}
              </Text>
            </View>
            <Text variant="displaySmall">
              {activeTimer ? formatDuration(elapsedMinutes) : '0m'}
            </Text>
            {!activeTimer ? (
              <Button
                icon="play-circle-outline"
                mode="contained"
                loading={isBusy}
                disabled={isBusy || !isReady}
                onPress={startTimer}>
                Start timer
              </Button>
            ) : (
              <View style={styles.timerActions}>
                <Button
                  icon={activeTimer.pausedAt ? 'play-circle-outline' : 'pause-circle-outline'}
                  mode="contained-tonal"
                  compact
                  style={styles.timerActionButton}
                  loading={isBusy}
                  disabled={isBusy || !isReady}
                  onPress={activeTimer.pausedAt ? resumeTimer : pauseTimer}>
                  {activeTimer.pausedAt ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  icon="stop-circle-outline"
                  mode="contained"
                  compact
                  style={styles.timerActionButton}
                  loading={isBusy}
                  disabled={isBusy || !isReady}
                  onPress={openStopTypePicker}>
                  Stop
                </Button>
                <Button
                  icon="close-circle-outline"
                  mode="outlined"
                  compact
                  textColor="#8f1d18"
                  style={[styles.timerActionButton, styles.cancelTimerButton]}
                  disabled={isBusy || !isReady}
                  onPress={cancelTimer}>
                  Cancel
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        <View style={styles.summaryGrid}>
          <Surface elevation={1} style={styles.summaryTile}>
            <Text variant="labelMedium" style={styles.muted}>
              Direct time
            </Text>
            <Text variant="headlineSmall">{formatDuration(directSummary.minutes)}</Text>
          </Surface>
          <Surface elevation={1} style={styles.summaryTile}>
            <Text variant="labelMedium" style={styles.muted}>
              Daily units
            </Text>
            <Text variant="headlineSmall">{directSummary.directUnits}</Text>
          </Surface>
          <Surface elevation={1} style={styles.summaryTile}>
            <Text variant="labelMedium" style={styles.muted}>
              Indirect
            </Text>
            <Text variant="headlineSmall">{indirectSummary.directUnits}</Text>
          </Surface>
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text variant="titleLarge">Blocks</Text>
            <Text variant="bodySmall" style={styles.muted}>
              Recommended indirect: {recommendedIndirectUnits} units
            </Text>
          </View>
          <Button icon="plus" mode="contained-tonal" onPress={() => openEditor()}>
            Add
          </Button>
        </View>

        {!isReady ? (
          <ActivityIndicator style={styles.loading} />
        ) : selectedBlocks.length === 0 ? (
          <Surface elevation={0} style={styles.emptyState}>
            <Text variant="titleMedium">No blocks recorded</Text>
            <Text variant="bodyMedium" style={styles.muted}>
              Start the timer or add a manual block for this date.
            </Text>
          </Surface>
        ) : (
          <View style={styles.blockList}>
            {selectedBlocks.map((block) => (
              <Card
                key={block.id}
                mode="outlined"
                style={[
                  styles.blockCard,
                  block.blockType === 'direct' ? styles.directBlockCard : styles.indirectBlockCard,
                ]}>
                <Card.Content style={styles.blockContent}>
                  <View style={styles.blockMain}>
                    <Text variant="bodySmall" numberOfLines={1} style={styles.blockTime}>
                      {formatClockTime(block.startAt)} - {formatClockTime(block.endAt)}
                    </Text>
                    <Text variant="bodySmall" numberOfLines={1} style={styles.blockDuration}>
                      {formatDuration(block.durationMinutes)}
                    </Text>
                  </View>
                  <View style={styles.blockActions}>
                    <Chip
                      compact
                      textStyle={[
                        styles.typeChipText,
                        block.blockType === 'direct'
                          ? styles.directChipText
                          : styles.indirectChipText,
                      ]}
                      style={[
                        styles.typeChip,
                        block.blockType === 'direct' ? styles.directChip : styles.indirectChip,
                      ]}>
                      {block.blockType === 'direct' ? 'D' : 'I'}
                    </Chip>
                    <Chip compact textStyle={styles.sourceChipText} style={styles.sourceChip}>
                      {block.source}
                    </Chip>
                    <IconButton
                      icon="pencil"
                      size={18}
                      style={styles.editButton}
                      onPress={() => openEditor(block)}
                    />
                  </View>
                </Card.Content>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      <BlockEditor
        visible={editorVisible}
        selectedDate={selectedDate}
        block={editingBlock}
        isBusy={isBusy}
        onDismiss={() => setEditorVisible(false)}
        onSave={async (input, blockId) => {
          if (blockId) {
            await updateBlock(blockId, input);
            return;
          }

          await addManualBlock(input);
        }}
        onDelete={deleteBlock}
      />

      <Snackbar visible={Boolean(error)} onDismiss={clearError}>
        {error}
      </Snackbar>

      <Portal>
        <Modal
          visible={stopTypeVisible}
          onDismiss={() => setStopTypeVisible(false)}
          contentContainerStyle={styles.stopModal}>
          <Surface elevation={2} style={styles.stopSheet}>
            <View>
              <Text variant="titleLarge">Save timer as</Text>
              <Text variant="bodyMedium" style={styles.muted}>
                {formatDuration(elapsedMinutes)} will be added to the selected block type.
              </Text>
            </View>
            <SegmentedButtons
              value={timerStopType}
              onValueChange={(value) => setTimerStopType(value as TimeBlockType)}
              buttons={[
                { value: 'direct', label: 'Direct', icon: 'account-clock-outline' },
                { value: 'indirect', label: 'Indirect', icon: 'clipboard-clock-outline' },
              ]}
            />
            <View style={styles.stopActions}>
              <Button disabled={isBusy} onPress={() => setStopTypeVisible(false)}>
                Cancel
              </Button>
              <Button mode="contained" loading={isBusy} disabled={isBusy} onPress={handleStopTimer}>
                Save
              </Button>
            </View>
          </Surface>
        </Modal>
      </Portal>
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
  dateRail: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  timerCard: {
    borderRadius: 8,
  },
  timerContent: {
    gap: 16,
  },
  timerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  timerActionButton: {
    flex: 1,
  },
  cancelTimerButton: {
    backgroundColor: '#fff4f2',
    borderColor: '#8f1d18',
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
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loading: {
    paddingVertical: 24,
  },
  emptyState: {
    borderRadius: 8,
    gap: 6,
    padding: 18,
  },
  blockList: {
    gap: 10,
  },
  blockCard: {
    borderRadius: 8,
    borderLeftWidth: 5,
  },
  directBlockCard: {
    borderLeftColor: '#126c52',
  },
  indirectBlockCard: {
    borderLeftColor: '#8a5a00',
  },
  blockContent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  blockMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  blockTime: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  blockDuration: {
    opacity: 0.68,
    width: 46,
  },
  blockActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  typeChip: {
    borderRadius: 8,
    borderWidth: 1,
    height: 26,
    minWidth: 30,
  },
  directChip: {
    backgroundColor: '#f4fbf7',
    borderColor: '#126c52',
  },
  indirectChip: {
    backgroundColor: '#fff8e8',
    borderColor: '#8a5a00',
  },
  typeChipText: {
    fontSize: 11,
    lineHeight: 14,
    marginHorizontal: 0,
  },
  directChipText: {
    color: '#126c52',
  },
  indirectChipText: {
    color: '#6f4600',
  },
  sourceChip: {
    backgroundColor: 'transparent',
    height: 26,
  },
  sourceChipText: {
    fontSize: 11,
    lineHeight: 14,
    marginHorizontal: 0,
  },
  editButton: {
    height: 30,
    margin: 0,
    width: 30,
  },
  stopModal: {
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  stopSheet: {
    borderRadius: 8,
    gap: 18,
    padding: 18,
  },
  stopActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
});
