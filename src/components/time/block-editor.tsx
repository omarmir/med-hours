import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Modal, Portal, SegmentedButtons, Surface, Text } from 'react-native-paper';

import { DateTimeField } from '@/components/time/date-time-field';
import {
  TimeBlock,
  TimeBlockType,
  createManualBlockInput,
  formatDateKey,
  parseDateKey,
} from '@/domain/time';

type BlockEditorProps = {
  visible: boolean;
  selectedDate: string;
  block?: TimeBlock | null;
  isBusy: boolean;
  onDismiss: () => void;
  onSave: (input: ReturnType<typeof createManualBlockInput>, blockId?: number) => Promise<void>;
  onDelete: (blockId: number) => Promise<void>;
};

function dateFromIso(iso: string) {
  return new Date(iso);
}

function defaultStart() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  return date;
}

function defaultEnd(start: Date) {
  const date = new Date(start);
  date.setHours(date.getHours() + 1);
  return date;
}

export function BlockEditor({
  visible,
  selectedDate,
  block,
  isBusy,
  onDismiss,
  onSave,
  onDelete,
}: BlockEditorProps) {
  const initialStart = useMemo(() => defaultStart(), []);
  const [workDate, setWorkDate] = useState(parseDateKey(selectedDate));
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(defaultEnd(initialStart));
  const [blockType, setBlockType] = useState<TimeBlockType>('direct');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }

    setLocalError(null);

    if (block) {
      setWorkDate(parseDateKey(block.workDate));
      setStartTime(dateFromIso(block.startAt));
      setEndTime(dateFromIso(block.endAt));
      setBlockType(block.blockType);
      return;
    }

    const start = defaultStart();
    setWorkDate(parseDateKey(selectedDate));
    setStartTime(start);
    setEndTime(defaultEnd(start));
    setBlockType('direct');
  }, [block, selectedDate, visible]);

  const handleSave = async () => {
    try {
      const input = createManualBlockInput(formatDateKey(workDate), startTime, endTime, blockType);
      await onSave(input, block?.id);
      onDismiss();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Time block could not be saved.');
    }
  };

  const handleDelete = async () => {
    if (!block) {
      return;
    }

    await onDelete(block.id);
    onDismiss();
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <Surface elevation={2} style={styles.sheet}>
          <Text variant="titleLarge">{block ? 'Edit block' : 'Add block'}</Text>
          <View style={styles.fields}>
            <SegmentedButtons
              value={blockType}
              onValueChange={(value) => setBlockType(value as TimeBlockType)}
              buttons={[
                { value: 'direct', label: 'Direct', icon: 'account-clock-outline' },
                { value: 'indirect', label: 'Indirect', icon: 'clipboard-clock-outline' },
              ]}
            />
            <DateTimeField label="Date" mode="date" value={workDate} onChange={setWorkDate} />
            <DateTimeField label="Start" mode="time" value={startTime} onChange={setStartTime} />
            <DateTimeField label="End" mode="time" value={endTime} onChange={setEndTime} />
          </View>
          {localError ? <Text style={styles.error}>{localError}</Text> : null}
          <View style={styles.actions}>
            {block ? (
              <Button textColor="#b3261e" disabled={isBusy} onPress={handleDelete}>
                Delete
              </Button>
            ) : null}
            <View style={styles.actionGroup}>
              <Button disabled={isBusy} onPress={onDismiss}>
                Cancel
              </Button>
              <Button mode="contained" loading={isBusy} disabled={isBusy} onPress={handleSave}>
                Save
              </Button>
            </View>
          </View>
        </Surface>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    paddingHorizontal: 16,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderRadius: 8,
    gap: 18,
    padding: 18,
  },
  fields: {
    gap: 12,
  },
  error: {
    color: '#b3261e',
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionGroup: {
    flexDirection: 'row',
    gap: 8,
  },
});
