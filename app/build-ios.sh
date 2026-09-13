#!/bin/bash
# Build the iOS app.
#
# Same shape as build-apk.sh and for the same reason: the repo lives in iCloud
# Drive, and Xcode's build system uses hard links and clonefile, which iCloud
# refuses. The project is mirrored to a plain local directory and built there.
#
# By default this builds for the Simulator, which needs no signing and no
# Apple developer account — enough to prove the app compiles and runs, and
# enough to look at it. Putting it on a real iPhone needs a paid Apple
# Developer membership and a signing identity, which belong to the owner;
# open the mirrored project in Xcode, pick the team, and Run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HOME/.dermaluxe-staff-app/ios"
DEST="${1:-generic/platform=iOS Simulator}"

echo "→ refreshing www/ from the website files"
node "$HERE/build-shell.js"

# cap copy is what actually puts www/ into ios/App/App/public. Without it the
# build happily packs the previous shell under a new version number.
find "$HERE" -name '* [0-9].*' -not -path '*/node_modules/*' -delete 2>/dev/null || true
echo "→ cap copy ios"
( cd "$HERE" && npx cap copy ios )

echo "→ mirroring the project to $WORK"
mkdir -p "$WORK"
rsync -a --delete \
  --exclude '* [0-9].*' \
  --exclude 'android' \
  --exclude 'ios/App/build' \
  --exclude 'dist' \
  "$HERE/" "$WORK/"

echo "→ xcodebuild"
( cd "$WORK" && xcodebuild -project ios/App/App.xcodeproj -scheme App \
    -configuration Release -sdk iphonesimulator -destination "$DEST" \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO build -quiet )

APP="$WORK/build/Build/Products/Release-iphonesimulator/App.app"
[ -d "$APP" ] || { echo "✗ no App.app was produced" >&2; exit 1; }

# the same guard the Android build has: never ship yesterday's shell
BUILT="$(md5 -q "$APP/public/index.html")"
WANT="$(md5 -q "$HERE/www/index.html")"
if [ "$BUILT" != "$WANT" ]; then
  echo "✗ the build contains a different index.html than www/ — stale, refusing." >&2
  exit 1
fi
echo "✓ $APP"
echo "✓ shell matches www/"
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Info.plist" | sed 's/^/  version /'
