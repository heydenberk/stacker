# TV Screens Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> Interface-and-tests style, like Plans 4 and the crate editor. Logic is pure and test-first. Screens are verified by hand, in desktop Chrome and on the TV.

**Goal:** Replace the debug page with the real TV experience:
- sign-in and device setup;
- a crate picker;
- the **Direction A "Liner Notes"** now-playing screen;
- on-screen messages and the record-change card;
- remote-control handling;
- the **"Take over the TV"** setting.

The debug page stays reachable at `?debug`.

**Spec:** `docs/superpowers/specs/2026-10-02-stacker-design.md` (Screens, Remote controls, Takeover setting, on-TV results).
**Mockup:** `/private/tmp/claude-501/-Users-eric-git-stacker/24a060e3-f4ff-441d-b9d7-1360be3f18b9/scratchpad/stacker-design/project/Main.dc.html` (artboard "A · Liner Notes").
- **Fonts:** Instrument Serif and JetBrains Mono.
- **Colours:** ground #15120F, text #EFE6D8, accent #F6C77A / #E2AE62.
- **Layout:** blurred cover background, 660 px cover, segmented progress bar, track list, crate strip.
- **Stars:** hidden by default.

**Branch:** `feat/tv-ui`, in `/Users/eric/git/stacker`. Never touch `/Users/eric/git/stacker-editor`.
**Out of scope:** new crate-builder or editor features, and Android shell changes. The shell bridge already exposes `isOtherAudioPlaying`, `bringToFront`, `info` and the Back hook `window.stackerBack`.

---

### Task S1: Conductor and runner additions

**Files:** `web/src/conductor/{types,step}.ts`, `web/src/runner.ts`, `web/src/spotify/player.ts`, `web/src/shell.ts`, and their tests.

1. **Play origin.**
   - Each `play` action gains `origin: 'user' | 'auto'`.
   - It is `'user'` when the step was caused by `chooseCrate`, `resume`, `togglePause` (resume path), `skipRecord`, `nextTrack` (advance) or `deviceReady` following a user action.
   - It is `'auto'` for advances on snapshot/finish, the starting retry, `crateUpdated`, `playFailed` and `deviceReady` after an automatic start.
   - Track this through `StepContext` or derive it from the event type. Test each.
2. **Takeover gate.**
   - New `StepContext` field: `holdAutoStarts: boolean`.
   - When it is true, an auto play is not emitted. The conductor enters a new mode `'held'`, keeping pos/track/progress and offering a resume.
   - Event `{ type: 'release' }` from `held` → `startRecord(origin 'auto')`. `resume` and `togglePause` from `held` → user play.
   - `nextPollDelay('held')` = 5 s.
   - Tests:
     - a finish with hold on → `held` with no action;
     - `release` → play;
     - a user `resume` from `held` → play;
     - hold off → unchanged behaviour.
3. **Previous track.** `previousTrack` when `progressMs > 3000` → `{ type: 'seek', positionMs: 0 }`; otherwise `previous`. Add `seek(deviceId, positionMs)` to `PlayerApi` (`PUT /me/player/seek?position_ms=&device_id=`), with tests.
4. **Problems are per crate.** Add `crateId` to `Problem`. Add `problemsFor(state, crateId)`. `chooseCrate` keeps other crates' problems.
5. **Runner: takeover setting.**
   - `takeover` is persisted at `stacker.takeover`, default `true`, through `setTakeover(on)`.
   - On each poll, the runner computes `otherAudio = shell?.isOtherAudioPlaying() === true && !(snapshot?.isPlaying)`, since the shell reports any audio, Spotify's included.
   - It passes `holdAutoStarts = !takeover && otherAudio` into `StepContext`.
   - While `held` and the hold has cleared, it dispatches `release`.
   - **After any auto play executes** with takeover on and a shell present, it calls `shell.bringToFront()`.
     - Don't gate this on `document.visibilityState`. The shell never pauses the WebView, so the page always reports `visible`.
     - If Stacker is already in front, the call does nothing.
   - Tests with a fake shell:
     - takeover off + other audio → held, with no play call;
     - the audio stops → play;
     - takeover on + auto play → `bringToFront` called;
     - takeover on + user play → not called;
     - no shell → no call.
6. **Runner: structured status.**
   - `RunnerView.status: { kind: 'ok' | 'offline' | 'rateLimited' | 'signedOut' | 'premium' | 'stoppedTrying' | 'error'; message: string | null }`, derived from the existing error fields and PlayerError kinds (`network` → offline).
   - Keep `error` for the debug page.
   - Tests map each kind.
7. **Wiring.** `RunnerDeps` gains an optional `shell: StackerShell | null`, and `main.tsx` passes `getShell()`.

### Task S2: Remote keys and navigation model

**Files:** `web/src/tv/keys.ts` and `web/src/tv/nav.ts`, with tests.

- **`keys.ts`:** `keyToCommand(e: KeyboardEvent): Command | null` maps:
  - `ArrowLeft`/`ArrowRight` → prevTrack/nextTrack (on now-playing);
  - `Enter`, `MediaPlayPause`, `' '` → togglePause;
  - `ArrowDown` → skipRecordPress;
  - `ArrowUp` → none on now-playing;
  - `MediaTrackNext`/`MediaTrackPrevious`;
  - `Escape`/`Backspace`/`GoBack` → back.
- **Skip confirmation:** `createSkipGuard(now)`. The first press returns `'armed'` (show "Press ▼ again to skip this record"). A second press within 3 s returns `'confirmed'`. After that it expires.
- **`nav.ts`:** a screen state machine.
  - Screens: `signIn | chooseDevice | picker | nowPlaying | settings`.
  - Startup: signed out → `signIn`. No device → `chooseDevice`. Mode `idle` → `picker`. Otherwise → `nowPlaying`.
  - **Back:** nowPlaying → picker; settings → picker; picker → not handled (return false, so the shell sends the app to the background); chooseDevice → picker if a device exists.
  - `window.stackerBack = () => nav.back()` returns a boolean **synchronously**.
- **Tests:** every key mapping, the skip guard timing, every nav transition, and the synchronous `stackerBack` return.

### Task S3: Screens

**Files:** `web/src/tv/*.tsx` and `web/src/tv/tv.css`. `web/src/main.tsx` renders `TvApp`, or the debug `App` when `?debug` is in the URL.

- **Sizing:** design for 1920×1080 CSS px, scaled with `transform: scale(innerWidth/1920)` on a fixed stage, so it works at any TV resolution. Body text ≥ 24 px. Load the fonts from Google Fonts in `index.html`.
- **SignIn:** the app name, one large focused **Connect Spotify** button, and a sign-in error if there is one.
- **ChooseDevice:**
  - a list of devices as large focusable buttons;
  - "Can't see your TV? Open the Spotify app once, then press OK to refresh";
  - choosing one calls `runner.setDevice(name, id)`, then goes to the picker.
- **CratePicker:**
  - **Cards:** a horizontal row of crate cards, focusable and moved with ◀ ▶. Each card shows:
    - a 2×2 cover mosaic from the first 4 records;
    - the name and mood line;
    - "N records";
    - "Resume at record N" if it's the in-progress crate;
    - "2 records couldn't play" if it has problems.
  - **Actions:** OK starts a crate. On the in-progress crate, OK dispatches `resume` (not `chooseCrate`). A small "Start over" option is reachable with ▼.
  - A trailing **Settings** card leads to:
    - the takeover toggle;
    - Change device;
    - Sign out;
    - the sign-in expiry date.
- **NowPlaying:** a faithful port of mockup A, driven by `RunnerView`.
  - Progress is interpolated every 250 ms while `playing`, as `progressMs + (now − lastSeenAt)`, capped at the track duration.
  - The track list highlights the current track.
  - The bottom strip shows every cover in the crate's order (played dimmed, current enlarged) plus "Up next".
  - A missing `coverUrl` shows a placeholder tile with the album initials.
- **Overlays** (centred cards over now-playing, with text ≥ 32 px):
  - `paused` → "Paused";
  - `yielded` → "You're playing something else. OK to go back to <crate>";
  - `awaitingResume` → "Resume <crate> — record N: <title>?" (OK);
  - `held` → "Waiting for the other audio to stop — OK to play now";
  - `needsDevice` → "Open Spotify on the TV";
  - `status.kind` `offline` / `rateLimited` → a small top banner;
  - `stoppedTrying` and `premium` → cards;
  - skip armed → "Press ▼ again to skip this record";
  - **Expiry banner:** within 14 days of `signInExpiresAt`, a top banner says "Spotify sign-in expires in N days".
- **Record change:** when `pos` changes while on now-playing, show a "Record N of M — <title>" card for 3 s, with a 600 ms cross-fade of the background and cover.
- **Focus:**
  - every interactive element is a real `<button>`;
  - focus moves with arrow keys via a small `useRovingFocus` helper in lists, and focused elements get a clear 4 px accent ring;
  - **on now-playing nothing is focusable** and keys go to `keyToCommand`.

**Verify:** `npm test && npm run typecheck && npm run build`. Then a manual pass in desktop Chrome at `http://127.0.0.1:5173/stacker/` with keyboard arrows, Enter and Escape: sign in, pick a device, start a crate, skip with ▼ twice, Back to the picker, Resume.

### Task S4: On the TV (with Eric, when the TV is free)

1. Merge to `main`, which deploys Pages. Then restart the app on the TV: `adb -s <tv> shell am force-stop com.heydenberk.stacker && adb -s <tv> shell am start -n com.heydenberk.stacker/.MainActivity`.
2. Walk the remote through: picker → start crate → now-playing, then ◀ ▶ OK ▼▼ and Back. Check the Back key reaches the page, and leaves the app from the picker.
3. **Takeover on:** play YouTube, then let a record finish. Stacker should come to the front with the next record.
4. **Takeover off:** with YouTube playing, Stacker waits (`held`). Stop YouTube and the record starts.
5. Note anything ugly at 10 ft and fix it in a follow-up.
