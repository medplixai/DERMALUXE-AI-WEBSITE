# DermaLuxe Staff — Android app

A Capacitor shell around the staff dashboard. The web shell (`staff.html` and
its assets) is copied into `www/` and packed into the APK; every bit of data
still comes live from `https://www.dermaluxe.ai/api/*`. `CapacitorHttp` is on,
so those calls go through native HTTP and need no CORS headers on the server.

## Rebuild the APK

```bash
cd app && npm run apk
```

That runs `build-apk.sh`, which refreshes `www/`, mirrors the project to
`~/.dermaluxe-staff-app/project`, builds there, and copies the signed APK back
into `dist/`.

**Why the mirror:** this repo lives in iCloud Drive, and Gradle merges resources
and assets by creating hard links, which iCloud refuses with "Operation not
permitted". `node_modules` is a symlink to `~/.dermaluxe-staff-app/node_modules`
for the same reason. Building in place will fail; use the script.

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

## Plugins

`@capacitor/push-notifications`, `camera`, `share`, `haptics`, `app`, and
`@aparajita/capacitor-biometric-auth`.

## What is deliberately not here

No offline data cache yet — that is phase 5. The app reads live from the API
every time.
