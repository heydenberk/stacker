#!/usr/bin/env bash
# Install the Stacker TV shell on the Google TV over wireless adb.
#
#   usage: scripts/tv-install.sh <tv-ip:port> [apk]
#
# Without an apk path, downloads the debug APK from the latest successful
# android.yml run on $BRANCH (default main; needs `gh` signed in).
#
#   BRANCH=feat/tv-shell scripts/tv-install.sh 192.168.1.20:37123
set -euo pipefail

PKG=com.heydenberk.stacker
REPO=heydenberk/stacker
ARTIFACT=stacker-tv-debug
BRANCH=${BRANCH:-main}

usage() {
  echo "usage: $0 <tv-ip:port> [apk]" >&2
  exit 2
}

step() {
  printf '\n==> %s\n' "$*"
}

fail() {
  printf '\nerror: %s\n' "$*" >&2
  exit 1
}

hint() {
  echo "hint: Is Wireless debugging on? The port changes when it's toggled; check the TV's Wireless debugging screen." >&2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
target=$1
apk=${2:-}
# adb names the device "<host>:<port>", and that name is what -s needs below.
[[ $target == *:* ]] || target="$target:5555"

command -v adb >/dev/null || fail "adb not found. Install it with: brew install --cask android-platform-tools"

step "Connecting to $target"
connect_out=$(adb connect "$target" 2>&1) || true
echo "$connect_out"
if ! grep -qE '^(connected|already connected) to ' <<<"$connect_out"; then
  hint
  fail "could not connect to $target"
fi
ADB=(adb -s "$target")

tmpdir=""
cleanup() {
  if [[ -n $tmpdir ]]; then rm -rf "$tmpdir"; fi
}
trap cleanup EXIT

if [[ -z $apk ]]; then
  command -v gh >/dev/null || fail "gh not found; pass an apk path or install the GitHub CLI"
  step "Finding the latest successful android.yml run on $BRANCH"
  run_id=$(gh run list --repo "$REPO" --workflow android.yml --branch "$BRANCH" --status success \
    --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [[ -n $run_id ]] || fail "no successful android.yml run on $BRANCH in $REPO"
  echo "run $run_id"

  step "Downloading $ARTIFACT from run $run_id"
  tmpdir=$(mktemp -d)
  gh run download "$run_id" --repo "$REPO" --name "$ARTIFACT" --dir "$tmpdir"
  apk=$(find "$tmpdir" -name '*.apk' -print -quit)
  [[ -n $apk ]] || fail "artifact $ARTIFACT contained no .apk"
fi
[[ -f $apk ]] || fail "apk not found: $apk"

step "Installing $apk"
# -r keeps app data (and so the Spotify sign-in); -d allows installing an older build.
install_status=0
install_out=$("${ADB[@]}" install -r -d "$apk" 2>&1) || install_status=$?
echo "$install_out"
if grep -q INSTALL_FAILED_UPDATE_INCOMPATIBLE <<<"$install_out"; then
  echo "Signature mismatch with the installed app — uninstall it first (this signs you out of Spotify):" >&2
  echo "  adb -s $target uninstall $PKG" >&2
  fail "adb install failed"
fi
# Older adb versions exit 0 even when the install fails, so check the output as well.
if [[ $install_status -ne 0 ]] || ! grep -q '^Success' <<<"$install_out"; then
  fail "adb install failed"
fi

step "Allowing display over other apps (needed for bringToFront)"
"${ADB[@]}" shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow || fail "appops set failed"

step "Granting POST_NOTIFICATIONS (for the keep-alive notification)"
"${ADB[@]}" shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || echo "(not granted; continuing)"

step "Launching Stacker"
"${ADB[@]}" shell am start -n "$PKG/.MainActivity" || fail "am start failed"

step "Done"
