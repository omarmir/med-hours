import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button } from 'react-native-paper';

type DateTimeFieldProps = {
  label: string;
  mode: 'date' | 'time';
  value: Date;
  onChange: (value: Date) => void;
};

export function DateTimeField({ label, mode, value, onChange }: DateTimeFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const formatter =
    mode === 'date'
      ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setIsOpen(false);
    }

    if (selected) {
      onChange(selected);
    }
  };

  return (
    <View>
      <Button
        icon={mode === 'date' ? 'calendar' : 'clock-outline'}
        mode="outlined"
        onPress={() => setIsOpen(true)}>
        {label}: {formatter.format(value)}
      </Button>
      {isOpen ? (
        <DateTimePicker mode={mode} value={value} onChange={handleChange} is24Hour={false} />
      ) : null}
    </View>
  );
}
