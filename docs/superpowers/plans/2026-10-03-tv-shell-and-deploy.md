# TV Shell & Deploy Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> This plan uses the same interface-and-tests style as the crate-editor plan, so it can run in parallel with the editor. The Android code is spelled out in more detail, because there's no local Android toolchain: the APK builds only in GitHub Actions.

**Goal:**
- Publish the web app at **https://heydenberk.com/stacker/** (GitHub Pages, public repo `heydenberk/stacker`).
- Build a small sideloaded **Android TV shell** that:
  - shows the web app full-screen on the Google TV;
  - keeps it running while other apps are in front;
  - exposes a JS bridge for "is other audio playing?" and "bring Stacker to the front".

**Spec:**
- `docs/superpowers/specs/2026-10-02-stacker-design.md`: TV shell, the shell notes, and the takeover setting.
- Research: `docs/superpowers/research/2026-10-03-android-tv-shell.md`. Read it before Tasks P3–P5.

**Decisions:**
- **Repo and hosting:** a public repo; GitHub Pages; Vite `base: '/stacker/'` in dev as well as prod.
- **Sign-in redirect:** Spotify redirects to the app root (`…/stacker/`), and the app detects `?code=` / `?error=`.
- **APK build:** GitHub Actions only, using AGP 8.13.x, Gradle 8.13 (via setup-gradle, no wrapper), JDK 17, compileSdk 35, targetSdk 34, Kotlin 2.x. No Compose, no AndroidX UI libraries beyond the core.
- **Keeping it alive:** a `specialUse` foreground service, and the WebView is never paused.

**Out of scope (Plan 3):** the real TV screens, the takeover toggle UI, and the conductor gate. This plan only provides the bridge, plus a debug-page readout to test it.

---

### Task P1: Web app — base path, sign-in redirect, shell awareness

**Files:**
- Create: `web/src/boot.ts` and `web/src/boot.test.ts`, `web/src/shell.ts` and `web/src/shell.test.ts`.
- Modify: `vite.config.ts`, `web/src/main.tsx`, `web/src/debug/App.tsx`.

**`boot.ts` (pure):**
```ts
export function appRootUrl(origin: string, baseUrl: string): string;          // ('https://heydenberk.com', '/stacker/') → 'https://heydenberk.com/stacker/'
export function authCallbackParams(search: string): { code: string | null; error: string | null } | null; // null when neither present
```

**`shell.ts`:**
```ts
export interface StackerShell { isOtherAudioPlaying(): boolean; bringToFront(): void; info(): string /* JSON */ }
export function getShell(w: unknown = globalThis): StackerShell | null;   // window.StackerShell if all three methods exist
```

**Changes:**
- **`vite.config.ts`:** add `base: '/stacker/'`. The dev URL becomes http://127.0.0.1:5173/stacker/.
- **`main.tsx`:**
  - `redirectUri = appRootUrl(location.origin, import.meta.env.BASE_URL)`.
  - When `authCallbackParams(location.search)` is non-null, run `completeSignIn(location.href)`.
    - On success, `history.replaceState(null, '', import.meta.env.BASE_URL)`.
    - On error, also clear the query with `replaceState`, and render the error with a "Back to Stacker" link to `BASE_URL`.
  - Visibility: only `runner.stop()` on hidden when `getShell()` is null. Inside the TV shell, keep running.
- **`debug/App.tsx`:** add a "TV shell" section, shown only when `getShell()` is present. It shows:
  - the `info()` JSON (model, SDK, WebView UA);
  - a live `isOtherAudioPlaying()` reading, refreshed every 2 s;
  - a button "Bring to front in 20 s", for testing from another app.

**Tests:**
- `appRootUrl`, with and without trailing slashes.
- `authCallbackParams`: code only, error only, neither, and code with other params.
- `getShell`: returns null when the object is absent or incomplete, and the object when it's complete.

**Verify:**
- `npm test && npm run typecheck && npm run build`.
- `dist/index.html` references `/stacker/assets/…`.

**User step (Eric):** in the Spotify dashboard → Stacker → Settings → Redirect URIs, add `http://127.0.0.1:5173/stacker/` and `https://heydenberk.com/stacker/`. Keep `/callback` until this ships.

---

### Task P2: Public repo + GitHub Pages deploy (with Eric's go-ahead)

**Files:** `.github/workflows/pages.yml`

**Before pushing (required):**
- **Secret scan:** check that the Spotify client secret appears nowhere in git history. Run `git log -p --all | grep -c "<secret from .env>"` and expect 0. Never print the secret.
- Confirm `.env` was never committed: `git log --all -- .env` should be empty.
- **Ask Eric to confirm** before running `gh repo create heydenberk/stacker --public --source . --push`.

**Workflow (`pages.yml`):**
- Triggers: push to `main` and `workflow_dispatch`.
- Permissions: `contents: read`, `pages: write`, `id-token: write`.
- Concurrency group: `pages`.
- **Build job:** checkout → setup-node (lts, npm cache) → `npm ci` → `npm test` → `npm run build`, with env `SPOTIFY_CLIENT_ID: ${{ vars.SPOTIFY_CLIENT_ID }}` → configure-pages → upload-pages-artifact (path `dist`).
- **Deploy job:** deploy-pages, with environment `github-pages`.
- Pin actions to their current major versions. Check them with `gh api repos/actions/<name>/releases/latest --jq .tag_name`.

**Setup commands (after Eric's go-ahead):**
- Set the client ID as a repo variable without echoing it: `gh variable set SPOTIFY_CLIENT_ID --repo heydenberk/stacker --body "$(grep '^SPOTIFY_CLIENT_ID=' .env | cut -d= -f2)"`.
- Enable Pages with Actions as the source: `gh api -X POST repos/heydenberk/stacker/pages -f build_type=workflow`, or `PUT` if Pages already exists.

**Verify:**
- The Actions run is green.
- `curl -sI https://heydenberk.com/stacker/` returns 200.
- Eric signs in at https://heydenberk.com/stacker/ in desktop Chrome and plays a crate.

---

### Task P3: Android TV shell project

**Files** (all new, under `android/`):
```
android/settings.gradle.kts        # rootProject.name = "stacker-tv"; include(":app"); pluginManagement/dependencyResolutionManagement with google() + mavenCentral()
android/build.gradle.kts           # plugins { id("com.android.application") version "8.13.0" apply false; id("org.jetbrains.kotlin.android") version "2.2.20" apply false }
android/gradle.properties          # android.useAndroidX=true, kotlin.code.style=official, org.gradle.jvmargs=-Xmx2g
android/app/build.gradle.kts       # namespace/applicationId "com.heydenberk.stacker"; compileSdk 35; minSdk 26; targetSdk 34; versionCode from env GITHUB_RUN_NUMBER (default 1); buildConfigField STACKER_URL = "https://heydenberk.com/stacker/"; buildFeatures.buildConfig = true; dependency androidx.core:core-ktx
android/app/src/main/AndroidManifest.xml
android/app/src/main/java/com/heydenberk/stacker/MainActivity.kt
android/app/src/main/java/com/heydenberk/stacker/KeepAliveService.kt
android/app/src/main/java/com/heydenberk/stacker/ShellBridge.kt
android/app/src/main/res/drawable/banner.xml      # vector/shape banner (no PNGs needed)
android/app/src/main/res/drawable/ic_launcher.xml # vector icon
android/app/src/main/res/values/strings.xml       # app_name "Stacker"
.github/workflows/android.yml
```
Verify the plugin versions exist: check Maven/Google for AGP 8.13.x and a Kotlin 2.2.x compatible with it. Fall back to AGP 8.7.x with Kotlin 2.0.x if CI fails on resolution.

**Manifest:**
- **Permissions:** `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`, `SYSTEM_ALERT_WINDOW`, `REORDER_TASKS`.
- `uses-feature`: `android.software.leanback` (required=false) and `android.hardware.touchscreen` (required=false).
- **`<application>`:** `android:banner="@drawable/banner"`, `android:icon="@drawable/ic_launcher"`, `android:label="@string/app_name"`, `usesCleartextTraffic="true"` (the dev URL over the LAN), and theme `@android:style/Theme.DeviceDefault.NoActionBar.Fullscreen`.
- **MainActivity:**
  - `exported`, `launchMode="singleTask"`, `configChanges="orientation|screenSize|keyboard|keyboardHidden|navigation"`.
  - Intent-filters: `MAIN` + `LEANBACK_LAUNCHER`, and `MAIN` + `LAUNCHER`.
- **KeepAliveService:**
  - `foregroundServiceType="specialUse"`, `exported="false"`.
  - A `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Keeps the Stacker web app polling Spotify while other apps are in front"/>`.

**MainActivity (behaviour):**
- `onCreate`:
  - add `FLAG_KEEP_SCREEN_ON`;
  - start `KeepAliveService` with `startForegroundService`;
  - create the WebView:
    - `javaScriptEnabled`, `domStorageEnabled`, `databaseEnabled`, `mediaPlaybackRequiresUserGesture = false`;
    - `CookieManager.setAcceptCookie(true)` and accept third-party cookies;
    - `WebView.setWebContentsDebuggingEnabled(true)`, so `chrome://inspect` works over adb.
  - `addJavascriptInterface(ShellBridge(this), "StackerShell")`.
  - `webViewClient` keeps every http(s) navigation in the WebView: return `false`.
  - Load the URL from `intent.getStringExtra("url")`, falling back to `BuildConfig.STACKER_URL`.
  - `requestFocus()`.
- **Never** call `webView.onPause()` or `pauseTimers()`. Don't override `onPause`/`onStop` to touch the WebView.
- **Back:**
  - Use `onBackPressedDispatcher`, or override `onKeyDown(KEYCODE_BACK)` on API < 33.
  - Run `webView.evaluateJavascript("window.stackerBack ? String(window.stackerBack()) : 'false'")`.
  - If the result is `"true"`, the page handled it. Otherwise call `moveTaskToBack(true)`, which keeps it running.
- `onNewIntent`: if a new `url` extra arrives, load it.
- `onDestroy`: `webView.destroy()`, then stop the service.

**ShellBridge** (`@JavascriptInterface` methods; this runs on a binder thread, so post UI work to the main looper):
- `isOtherAudioPlaying(): Boolean` = `AudioManager.isMusicActive()`. It is true for any app, Spotify included. The web side combines it with Spotify's `is_playing`; document this in KDoc.
- `bringToFront()`: start MainActivity with `FLAG_ACTIVITY_NEW_TASK or FLAG_ACTIVITY_REORDER_TO_FRONT or FLAG_ACTIVITY_SINGLE_TOP`. If that throws, fall back to `ActivityManager.moveTaskToFront(taskId, 0)`.
- `info(): String` = JSON with `{ model: Build.MODEL, sdk: Build.VERSION.SDK_INT, userAgent: WebSettings.getDefaultUserAgent(ctx), overlayAllowed: Settings.canDrawOverlays(ctx) }`.

**KeepAliveService:**
- In `onCreate`, create the notification channel `"keepalive"`, with low importance.
- In `onStartCommand`, call `startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)` (use the 3-arg form on API 29+). Return `START_STICKY`.
- The notification says "Stacker is running", and its content intent opens MainActivity.

**`android.yml` workflow:**
- Triggers: push with paths `android/**` and `.github/workflows/android.yml`, plus `workflow_dispatch`.
- Steps: ubuntu-latest → checkout → setup-java (temurin 17) → `gradle/actions/setup-gradle` with `gradle-version: '8.13'` → `gradle -p android assembleDebug` → upload-artifact `stacker-tv-debug` (path `android/app/build/outputs/apk/debug/app-debug.apk`).

**Verify:** the Android workflow is green, and the artifact downloads with `gh run download --name stacker-tv-debug`.

Iterate on CI failures using the logs (`gh run view --log-failed`). Make each fix a small commit.

---

### Task P4: Install script

**Files:** `scripts/tv-install.sh` (executable)

```
usage: scripts/tv-install.sh <tv-ip:port> [apk]
```
1. `adb connect <tv-ip:port>`.
2. If no apk path is given: `gh run download --repo heydenberk/stacker --name stacker-tv-debug --dir <tmp>`, from the latest successful `android.yml` run on `main`.
3. `adb install -r <apk>`.
4. Grant permissions:
   - `adb shell appops set com.heydenberk.stacker SYSTEM_ALERT_WINDOW allow`
   - `adb shell pm grant com.heydenberk.stacker android.permission.POST_NOTIFICATIONS || true`
5. Launch: `adb shell am start -n com.heydenberk.stacker/.MainActivity`.

Print each step. Exit non-zero on failure, with a hint ("Is Wireless debugging on? The port changes when it's toggled").

**Verify:** `bash -n scripts/tv-install.sh`, and `shellcheck` if it's installed.

---

### Task P5: On the TV (with Eric)
1. **Tools:** Eric approves `brew install --cask android-platform-tools` (about 15 MB).
2. **Developer options:** TV Settings → System → About → tap "Android TV OS build" 7 times. Then Developer options → Wireless debugging on → "Pair device with pairing code".
3. **Pair and connect:** `adb pair <ip>:<pairport>` (enter the code), then `adb connect <ip>:<port>`.
4. Run `scripts/tv-install.sh <ip>:<port>`. Stacker should appear in the TV's apps, and the shell section should appear on the debug page.
5. **Sign in** with email and password inside the TV app, then choose the TV's Spotify device and run Shuffle & play. Check:
   - the music plays;
   - the debug page shows the shell info, including the WebView Chromium version from the UA.
6. **Background running.** Press Home, open another app, and wait for a record to end. Use the phone to seek near the end of the last track to speed this up. Check:
   - the next record starts while Stacker is in the background;
   - `adb shell dumpsys activity processes | grep -A3 com.heydenberk.stacker` shows a foreground service, not cached.
7. **Other audio.** Play a YouTube video, then look at the "other audio playing" reading. It should be true while YouTube plays and Spotify is paused.
8. **Bring to front.** Press "Bring to front in 20 s", then switch to another app. Stacker should come to the front.
9. Record the results, including the Chromium version and anything that failed, in the spec's shell notes. Failures feed Plan 3's takeover design.
