import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import React from 'react';
import { useColorScheme } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import AppTabs from '@/components/app-tabs';
import { TimeStoreProvider } from '@/storage/time-store';

const lightPaperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#126c52',
    secondary: '#47655c',
    tertiary: '#6e5d1f',
    surfaceVariant: '#dce5df',
    background: '#f7faf7',
  },
};

const darkPaperTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#74d7b6',
    secondary: '#b3ccc2',
    tertiary: '#dcc66d',
    background: '#101513',
    surface: '#171d1a',
  },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <PaperProvider theme={isDark ? darkPaperTheme : lightPaperTheme}>
        <TimeStoreProvider>
          <AppTabs />
        </TimeStoreProvider>
      </PaperProvider>
    </ThemeProvider>
  );
}
