import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.backgroundElement,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons color={color} name="clock-time-four-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="month"
        options={{
          title: 'Month',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons color={color} name="calendar-month-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="backup"
        options={{
          title: 'Backup',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons color={color} name="cloud-lock-outline" size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
