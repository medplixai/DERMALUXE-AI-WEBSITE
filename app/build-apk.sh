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

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo "→ refreshing www/ from the website files"
node "$HERE/build-shell.js"

# cap copy is what actually puts www/ into android/app/src/main/assets/public.
# Without it Gradle happily packs the PREVIOUS build's HTML under a new version
# number — a "new release" that is the old app.
echo "→ cap copy android"
( cd "$HERE" && npx cap copy android )

echo "→ mirroring the project to $WORK"
mkdir -p "$WORK"
# node_modules travels too: the plugins' Android sources are compiled from it,
# and Gradle needs them on a filesystem that supports hard links.
rsync -a --delete \
  --exclude 'android/build' \
  --exclude 'android/app/build' \
  --exclude 'android/.gradle' \
  --exclude 'android/capacitor-cordova-android-plugins/build' \
  --exclude 'dist' \
  "$HERE/" "$WORK/"
echo "sdk.dir=$ANDROID_HOME" > "$WORK/android/local.properties"

echo "→ gradle assembleRelease"
( cd "$WORK/android" && ./gradlew assembleRelease --console=plain -q )

VERSION="$(node -p "require('$HERE/package.json').version")"
mkdir -p "$HERE/dist"
cp "$WORK/android/app/build/outputs/apk/release/app-release.apk" "$HERE/dist/DermaLuxe-Staff-$VERSION.apk"
echo "✓ dist/DermaLuxe-Staff-$VERSION.apk"
# guard against ever shipping a stale shell again
BUILT="$(unzip -p "$HERE/dist/DermaLuxe-Staff-$VERSION.apk" assets/public/index.html | md5 -q)"
WANT="$(md5 -q "$HERE/www/index.html")"
if [ "$BUILT" != "$WANT" ]; then
  echo "✗ APK contains a different index.html than www/ — stale build, refusing." >&2
  exit 1
fi
echo "✓ APK shell matches www/"

SIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)"
"$SIGNER" verify "$HERE/dist/DermaLuxe-Staff-$VERSION.apk" && echo "✓ signature verified"
