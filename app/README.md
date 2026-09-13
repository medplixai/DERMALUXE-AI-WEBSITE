# DermaLuxe Staff — Android app

A Capacitor shell around the staff dashboard. The web shell (`staff.html` and
its assets) is copied into `www/` and packed into the APK; every bit of data
still comes live from `https://www.dermaluxe.ai/api/*`. `CapacitorHttp` is on,
so those calls go through native HTTP and need no CORS headers on the server.

## Rebuild the APK

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd app
npm run apk
cp android/app/build/outputs/apk/release/app-release.apk dist/DermaLuxe-Staff-<version>.apk
```

`npm run shell` alone refreshes `www/` from the website files.

## Releasing a new version

1. Bump `versionCode` **and** `versionName` in `android/app/build.gradle`.
   Android refuses to install an APK whose `versionCode` is not higher.
2. Bump `version` in `package.json` so `app-version.json` matches.
3. `npm run apk`, then hand the file to staff.

## Signing — read this

`keystore.properties` and `dermaluxe-staff.keystore` are the release signing
key. Both are gitignored and exist only on this Mac.

**Back them up somewhere safe.** If they are lost, no future build can update
the installed app: every phone would have to uninstall and reinstall, losing
its session. There is no way to recover or reissue the same key.

## What is deliberately not here

No Firebase, no push, no camera, no biometrics yet — those are phases 3 and 4.
The app today is the dashboard, installed, with its own icon and splash.
