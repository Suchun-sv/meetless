#!/bin/bash
# Meetless Expo iOS simulator build and screenshots, headless (run on the Mac under nohup).
#   ML_WORKTREE   checkout of the repo to build        (default $HOME/github/meetless-expo)
#   ML_BUILD_DIR  derived data, logs, shots, token     (default $HOME/meetless-expo-build)
#   ML_REF        git ref to build                      (default origin/expo)
#   ML_SIM_NAME   simulator to use                      (default "iPhone 12 Pro Max"; 26.1 lacks CJK fonts)
#   ML_SIM_OS     its runtime                           (default 27.2)
#   ML_TOKEN_FILE personal token for the sample user    (default $ML_BUILD_DIR/alex-token.txt, 0600)
#   ML_TOUR       name=path,... screens to capture      (default: the sample project's main screens)
# Release configuration (JS bundled, no Metro), ad-hoc signed (the keychain needs a signature).
# The screenshot env vars are inlined at bundle time into this build only; normal builds never set them.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH LANG=en_US.UTF-8
W=${ML_WORKTREE:-$HOME/github/meetless-expo}
B=${ML_BUILD_DIR:-$HOME/meetless-expo-build}
REF=${ML_REF:-origin/expo}
TOKEN_FILE=${ML_TOKEN_FILE:-$B/alex-token.txt}
P=sample-paper
TOUR=${ML_TOUR:-home=/,dash=/p/$P,drawer=/p/$P?drawer=1,board=/p/$P/board,need=/p/$P/need/$P%3AN1,confirm=/p/$P/confirm,chat=/p/$P/chat,import=/p/$P/import,handoff=/p/$P/handoff?need=$P%3AN5,lineage=/p/$P/lineage/$P%3AN1,reminders=/reminders}
NAME="${ML_SIM_NAME:-iPhone 12 Pro Max} (${ML_SIM_OS:-27.2})"
UDID=$(xcrun simctl list devices available | grep -F "$NAME (" | head -1 | grep -oE '[0-9A-F-]{36}')
[ -n "$UDID" ] || { echo "no simulator named $NAME"; exit 1; }
mkdir -p "$B/shots"

cd "$W"
echo "== fetch $(date +%T)"; git fetch -q origin && git checkout -q --detach "$REF" && git log --oneline -1
echo "== install $(date +%T)"; npx -y pnpm@12.23.0 install --frozen-lockfile 2>&1 | tail -2
cd apps/app
export EXPO_PUBLIC_DEEPLINK_SIGNIN=1 EXPO_PUBLIC_SCREENSHOT_TOKEN="$(cat "$TOKEN_FILE")" EXPO_PUBLIC_SCREENSHOT_TOUR="$TOUR"
echo "== prebuild $(date +%T)"; npx expo prebuild --platform ios --clean 2>&1 | tail -4
echo "== xcodebuild $(date +%T)"
WS=$(ls -d ios/*.xcworkspace | head -1); SCHEME=$(basename "$WS" .xcworkspace)
xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
  -derivedDataPath "$B/dd" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= COMPILER_INDEX_STORE_ENABLE=NO build > "$B/xcodebuild.log" 2>&1 \
  || { grep -E "error:|BUILD FAILED" "$B/xcodebuild.log" | head -30; exit 1; }
APP=$(ls -d "$B"/dd/Build/Products/Release-iphonesimulator/*.app | head -1)
BID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist")

echo "== simulator $(date +%T) $NAME $UDID"
xcrun simctl shutdown "$UDID" 2>/dev/null || true
xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array zh-Hans en || true
xcrun simctl spawn "$UDID" defaults write -g AppleLocale zh_CN || true
xcrun simctl uninstall "$UDID" "$BID" 2>/dev/null || true
xcrun simctl keychain "$UDID" reset 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
echo "== entitlements: $(codesign -d --entitlements :- "$APP" 2>/dev/null | tr -d '\n' | sed 's/.*<plist[^>]*>//')"

rm -f "$B"/shots/*.png
xcrun simctl launch "$UDID" "$BID"
sleep 4; xcrun simctl io "$UDID" screenshot "$B/shots/signin.png" >/dev/null 2>&1
DOCS="$(xcrun simctl get_app_container "$UDID" "$BID" data)/Documents"
# Handshake with the app (src/state/screenshotTour.tsx): it writes tour-state.json when a step is
# ready; we screenshot it and write tour-ack with the step number.
last=-1
for _ in $(seq 1 600); do
  s=$(cat "$DOCS/tour-state.json" 2>/dev/null || true)
  step=$(printf '%s' "$s" | sed -n 's/.*"step":\([0-9]*\).*/\1/p')
  name=$(printf '%s' "$s" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
  if [ -n "$step" ] && [ "$step" != "$last" ]; then
    [ "$name" = done ] && break
    xcrun simctl io "$UDID" screenshot "$B/shots/$(printf '%02d' "$step")-$name.png" >/dev/null 2>&1
    echo "shot $step $name $(printf '%s' "$s" | grep -o '"matched":[a-z]*')"
    printf '%s' "$step" > "$DOCS/tour-ack"; last=$step
  fi
  sleep 0.5
done
echo "== DONE $(date +%T)"; ls "$B/shots"
