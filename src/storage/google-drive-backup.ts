import { BackupSnapshot, backupFileName, parseBackupSnapshot } from '@/domain/backup';

export const DRIVE_APP_DATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

export type DriveBackupFile = {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
};

export type GoogleDriveUser = {
  name: string | null;
  email: string | null;
};

export type DriveBackupClient = {
  connect: () => Promise<GoogleDriveUser | null>;
  signOut: () => Promise<void>;
  getCurrentUser: () => Promise<GoogleDriveUser | null>;
  uploadSnapshot: (snapshot: BackupSnapshot) => Promise<DriveBackupFile>;
  listBackupFiles: () => Promise<DriveBackupFile[]>;
  downloadSnapshot: (fileId: string) => Promise<BackupSnapshot>;
  deleteBackupFile: (fileId: string) => Promise<void>;
};

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');
type ReactNativeModule = typeof import('react-native');

let configured = false;

function missingNativeModuleError() {
  return new Error(
    'Google Sign-In is not available in this native build. Rebuild the Android app after installing @react-native-google-signin/google-signin; it will not work in Expo Go.',
  );
}

async function hasNativeGoogleSignInModule() {
  const { NativeModules } = (await import('react-native')) as ReactNativeModule;
  const turboModuleProxy = (globalThis as { __turboModuleProxy?: (name: string) => unknown })
    .__turboModuleProxy;

  return Boolean(NativeModules.RNGoogleSignin ?? turboModuleProxy?.('RNGoogleSignin'));
}

async function getGoogleSignInModule(): Promise<GoogleSignInModule> {
  if (!(await hasNativeGoogleSignInModule())) {
    throw missingNativeModuleError();
  }

  return import('@react-native-google-signin/google-signin');
}

function normalizeUser(user: unknown): GoogleDriveUser | null {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const userRecord = user as {
    data?: { user?: { name?: string | null; email?: string | null } };
    user?: { name?: string | null; email?: string | null };
  };
  const profile = userRecord.data?.user ?? userRecord.user;

  if (!profile) {
    return null;
  }

  return {
    name: profile.name ?? null,
    email: profile.email ?? null,
  };
}

async function configureGoogleSignIn() {
  if (configured) {
    return;
  }

  const { GoogleSignin } = await getGoogleSignInModule();
  GoogleSignin.configure({
    scopes: [DRIVE_APP_DATA_SCOPE],
  });
  configured = true;
}

async function readDriveResponse(response: Response) {
  const text = await response.text();

  if (!response.ok) {
    let message = `Google Drive request failed with status ${response.status}.`;

    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return text;
}

export class GoogleDriveBackupClient implements DriveBackupClient {
  async connect() {
    await configureGoogleSignIn();
    const { GoogleSignin, isSuccessResponse } = await getGoogleSignInModule();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();

    if (isSuccessResponse(response)) {
      return normalizeUser(response);
    }

    return null;
  }

  async signOut() {
    await configureGoogleSignIn();
    const { GoogleSignin } = await getGoogleSignInModule();
    await GoogleSignin.signOut();
  }

  async getCurrentUser() {
    await configureGoogleSignIn();
    const { GoogleSignin } = await getGoogleSignInModule();
    const current = GoogleSignin.getCurrentUser();

    if (current) {
      return normalizeUser(current);
    }

    if (!GoogleSignin.hasPreviousSignIn()) {
      return null;
    }

    const response = await GoogleSignin.signInSilently();
    return response.type === 'success' ? normalizeUser(response) : null;
  }

  async uploadSnapshot(snapshot: BackupSnapshot) {
    const accessToken = await this.getAccessToken();
    const boundary = `med-hours-${Date.now()}`;
    const metadata = {
      name: backupFileName(new Date(snapshot.exportedAt)),
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(snapshot),
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const response = await fetch(
      `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    const text = await readDriveResponse(response);
    return JSON.parse(text) as DriveBackupFile;
  }

  async listBackupFiles() {
    const accessToken = await this.getAccessToken();
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: "name contains 'med-hours-backup-' and trashed = false",
      fields: 'files(id,name,createdTime,modifiedTime,size)',
      orderBy: 'createdTime desc',
      pageSize: '100',
    });
    const response = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const text = await readDriveResponse(response);
    const body = JSON.parse(text) as { files?: DriveBackupFile[] };
    return body.files ?? [];
  }

  async downloadSnapshot(fileId: string) {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return parseBackupSnapshot(await readDriveResponse(response));
  }

  async deleteBackupFile(fileId: string) {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    await readDriveResponse(response);
  }

  private async getAccessToken() {
    await configureGoogleSignIn();
    const { GoogleSignin } = await getGoogleSignInModule();

    if (!GoogleSignin.getCurrentUser() && GoogleSignin.hasPreviousSignIn()) {
      await GoogleSignin.signInSilently();
    }

    if (!GoogleSignin.getCurrentUser()) {
      await this.connect();
    }

    const tokens = await GoogleSignin.getTokens();
    return tokens.accessToken;
  }
}
