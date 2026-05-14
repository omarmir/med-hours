import React from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Button,
  Card,
  Divider,
  IconButton,
  Snackbar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';

import { DriveBackupFile } from '@/storage/google-drive-backup';
import { useTimeStore } from '@/storage/time-store';

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Never';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function backupDate(file: DriveBackupFile) {
  return formatDateTime(file.createdTime ?? file.modifiedTime);
}

export default function BackupScreen() {
  const theme = useTheme();
  const {
    backup,
    error,
    isBackupBusy,
    clearError,
    connectBackup,
    signOutBackup,
    refreshBackups,
    backupNow,
    previewRestoreBackup,
    restoreBackup,
  } = useTimeStore();

  const latestBackup = backup.files[0];
  const statusLabel = backup.error ?? backup.backupState?.lastError ?? backup.status;

  const restoreFile = async (file: DriveBackupFile) => {
    const preview = await previewRestoreBackup(file);
    const exportedAt = formatDateTime(preview.snapshot.exportedAt);
    const blockCount = preview.snapshot.blocks.length;

    Alert.alert(
      'Replace local blocks?',
      `Backup exported ${exportedAt} contains ${blockCount} block${blockCount === 1 ? '' : 's'}. Restore will replace saved blocks and clear any active timer.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => {
            void restoreBackup(preview).catch(() => undefined);
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isBackupBusy}
            onRefresh={() => {
              void refreshBackups().catch(() => undefined);
            }}
          />
        }>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="headlineMedium">Backup</Text>
            <Text variant="bodyMedium" style={styles.muted}>
              Hidden Google Drive app data
            </Text>
          </View>
          {backup.isConnected ? (
            <Button
              mode="outlined"
              compact
              disabled={isBackupBusy}
              onPress={() => {
                void signOutBackup().catch(() => undefined);
              }}>
              Sign out
            </Button>
          ) : null}
        </View>

        <Surface elevation={1} style={styles.connectionPanel}>
          <View style={styles.connectionIcon}>
            <IconButton icon="cloud-lock-outline" size={30} />
          </View>
          <View style={styles.connectionCopy}>
            <Text variant="titleMedium">
              {backup.isConnected ? backup.userName ?? 'Google Drive connected' : 'Connect Google Drive'}
            </Text>
            <Text variant="bodyMedium" style={styles.muted}>
              {backup.isConnected
                ? backup.userEmail ?? 'Backups are stored in Drive app data.'
                : 'Use your Google account to store private app-only snapshots.'}
            </Text>
          </View>
          {!backup.isConnected ? (
            <Button
              icon="google"
              mode="contained"
              loading={isBackupBusy}
              disabled={isBackupBusy}
              onPress={() => {
                void connectBackup().catch(() => undefined);
              }}>
              Connect
            </Button>
          ) : null}
        </Surface>

        <Card mode="contained" style={styles.statusCard}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.statusHeader}>
              <View>
                <Text variant="titleMedium">Backup status</Text>
                <Text variant="bodyMedium" style={styles.muted}>
                  Last uploaded {formatDateTime(backup.backupState?.lastSuccessfulAt)}
                </Text>
              </View>
              {backup.status === 'uploading' || backup.status === 'scheduled' ? (
                <ActivityIndicator />
              ) : null}
            </View>
            <Divider />
            <View style={styles.statusRows}>
              <View style={styles.statusRow}>
                <Text variant="bodyMedium">Current state</Text>
                <Text variant="labelLarge" style={styles.statusValue}>
                  {statusLabel}
                </Text>
              </View>
              <View style={styles.statusRow}>
                <Text variant="bodyMedium">Drive versions</Text>
                <Text variant="labelLarge" style={styles.statusValue}>
                  {backup.files.length}
                </Text>
              </View>
            </View>
            <View style={styles.actionRow}>
              <Button
                icon="cloud-upload-outline"
                mode="contained"
                disabled={!backup.isConnected || isBackupBusy}
                loading={isBackupBusy && backup.status === 'uploading'}
                onPress={() => {
                  void backupNow().catch(() => undefined);
                }}>
                Backup now
              </Button>
              <Button
                icon="restore"
                mode="outlined"
                disabled={!latestBackup || isBackupBusy}
                onPress={() => {
                  if (latestBackup) {
                    void restoreFile(latestBackup).catch(() => undefined);
                  }
                }}>
                Restore latest
              </Button>
            </View>
          </Card.Content>
        </Card>

        <View style={styles.sectionHeader}>
          <View>
            <Text variant="titleLarge">Recent versions</Text>
            <Text variant="bodySmall" style={styles.muted}>
              Latest 10 snapshots are kept after each upload.
            </Text>
          </View>
          <IconButton
            icon="refresh"
            disabled={!backup.isConnected || isBackupBusy}
            onPress={() => {
              void refreshBackups().catch(() => undefined);
            }}
          />
        </View>

        {!backup.isConnected ? (
          <Surface elevation={0} style={styles.emptyState}>
            <Text variant="titleMedium">No Drive account connected</Text>
            <Text variant="bodyMedium" style={styles.muted}>
              Connect before creating or restoring backup files.
            </Text>
          </Surface>
        ) : backup.files.length === 0 ? (
          <Surface elevation={0} style={styles.emptyState}>
            <Text variant="titleMedium">No backups yet</Text>
            <Text variant="bodyMedium" style={styles.muted}>
              Create a backup now or wait for the next saved block change.
            </Text>
          </Surface>
        ) : (
          <View style={styles.versionList}>
            {backup.files.map((file, index) => (
              <Card key={file.id} mode="outlined" style={styles.versionCard}>
                <Card.Content style={styles.versionContent}>
                  <View style={styles.versionMain}>
                    <Text variant="titleSmall" numberOfLines={1}>
                      {index === 0 ? 'Latest backup' : `Backup ${index + 1}`}
                    </Text>
                    <Text variant="bodySmall" numberOfLines={1} style={styles.muted}>
                      {backupDate(file)}
                    </Text>
                  </View>
                  <Button
                    compact
                    icon="restore"
                    mode="contained-tonal"
                    disabled={isBackupBusy}
                    onPress={() => {
                      void restoreFile(file).catch(() => undefined);
                    }}>
                    Restore
                  </Button>
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
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  muted: {
    opacity: 0.68,
  },
  connectionPanel: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  connectionIcon: {
    alignItems: 'center',
    backgroundColor: '#e5f3ed',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  connectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  statusCard: {
    borderRadius: 8,
  },
  cardContent: {
    gap: 14,
  },
  statusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusRows: {
    gap: 8,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
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
  versionList: {
    gap: 10,
  },
  versionCard: {
    borderRadius: 8,
  },
  versionContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  versionMain: {
    flex: 1,
    minWidth: 0,
  },
});
