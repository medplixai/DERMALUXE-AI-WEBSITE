#!/bin/bash
# Build the signed APK.
#
# The repo lives in iCloud Drive, and Gradle's resource/asset merging uses hard
# links, which iCloud refuses ("Operation not permitted"). So the project is
# mirrored to a plain local directory, built there, and only the finished APK
# comes back. The repo stays the source of truth; WORK is disposable.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HOME/.dermaluxe-staff-app/project"
NM="$HOME/.dermaluxe-staff-app/node_modules"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo "→ refreshing www/ from the website files"
node "$HERE/build-shell.js"

echo "→ mirroring the project to $WORK"
mkdir -p "$WORK"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'android/build' \
  --exclude 'android/app/build' \
  --exclude 'android/.gradle' \
  --exclude 'android/capacitor-cordova-android-plugins/build' \
  --exclude 'dist' \
  "$HERE/" "$WORK/"
ln -sfn "$NM" "$WORK/node_modules"
echo "sdk.dir=$ANDROID_HOME" > "$WORK/android/local.properties"

echo "→ gradle assembleRelease"
( cd "$WORK/android" && ./gradlew assembleRelease --console=plain -q )

VERSION="$(node -p "require('$HERE/package.json').version")"
mkdir -p "$HERE/dist"
cp "$WORK/android/app/build/outputs/apk/release/app-release.apk" "$HERE/dist/DermaLuxe-Staff-$VERSION.apk"
echo "✓ dist/DermaLuxe-Staff-$VERSION.apk"
SIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)"
"$SIGNER" verify "$HERE/dist/DermaLuxe-Staff-$VERSION.apk" && echo "✓ signature verified"
