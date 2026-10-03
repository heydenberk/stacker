#!/usr/bin/env bash
# Install the Stacker TV shell on the Google TV over wireless adb.
#
#   usage: scripts/tv-install.sh <tv-ip:port> [apk]
#
# Without an apk path, downloads the debug APK from the latest successful
# android.yml run on main (needs `gh` signed in).
set -euo pipefail

PKG=com.heydenberk.stacker
REPO=heydenberk/stacker
ARTIFACT=stacker-tv-debug

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
  step "Finding the latest successful android.yml run on main"
  run_id=$(gh run list --repo "$REPO" --workflow android.yml --branch main --status success \
    --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [[ -n $run_id ]] || fail "no successful android.yml run on main in $REPO"
  echo "run $run_id"

  step "Downloading $ARTIFACT from run $run_id"
  tmpdir=$(mktemp -d)
  gh run download "$run_id" --repo "$REPO" --name "$ARTIFACT" --dir "$tmpdir"
  apk=$(find "$tmpdir" -name '*.apk' -print -quit)
  [[ -n $apk ]] || fail "artifact $ARTIFACT contained no .apk"
fi
[[ -f $apk ]] || fail "apk not found: $apk"

step "Installing $apk"
"${ADB[@]}" install -r "$apk" || { hint; fail "adb install failed"; }

step "Allowing display over other apps (needed for bringToFront)"
"${ADB[@]}" shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow || { hint; fail "appops set failed"; }

step "Granting POST_NOTIFICATIONS (for the keep-alive notification)"
"${ADB[@]}" shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || echo "(not granted; continuing)"

step "Launching Stacker"
"${ADB[@]}" shell am start -n "$PKG/.MainActivity" || { hint; fail "am start failed"; }

step "Done"
