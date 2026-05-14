# Med Hours

Med Hours is an Android time-tracking app for recording direct and indirect work blocks. It is built with Expo, React Native, TypeScript, Expo Router, React Native Paper, and local SQLite persistence.

## APK

A release APK is included in this repository because it is under GitHub's 100 MB file limit:

- [Download the APK](apk/med-hours-1.0.0.apk)

The APK is intended for local Android installation and testing.

## Features

- Track direct and indirect time blocks.
- Start, pause, stop, and cancel the active timer.
- Add, edit, and delete manual blocks.
- Split stopped timers across midnight.
- Prevent overlapping blocks on the same date and type.
- Calculate daily direct units from total daily direct minutes.
- Calculate recommended indirect capacity from raw direct minutes.
- Show monthly direct and indirect summaries with cap status.
- Store data locally with SQLite. No patient names, client identifiers, or clinical notes are stored.

## Development

Install dependencies:

```bash
pnpm install
```

Start the Expo development server:

```bash
pnpm start -- --host lan
```

Run on Android:

```bash
pnpm android
```

Run checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Building An APK

This project has an EAS profile for APK builds:

```bash
pnpm build:android:apk
```

For a local Gradle build after Expo prebuild has generated the native Android project:

```bash
cd android
JAVA_HOME=/home/omar/.local/share/jdks/temurin-21 \
ANDROID_HOME=/home/omar/Android/Sdk \
PATH=/home/omar/.local/share/jdks/temurin-21/bin:/home/omar/Android/Sdk/platform-tools:/home/omar/Android/Sdk/build-tools/36.1.0:$PATH \
./gradlew assembleRelease
```

The generated APK is copied into `apk/med-hours-1.0.0.apk` for repository download.
