# Android TV shell — research notes (2026-10-03)

Gathered for Plan 4. **Bold "test on device"** marks things no source confirmed.

## WebView setup
- **Settings:** `javaScriptEnabled`, `domStorageEnabled`, persistent cookies (`CookieManager.setAcceptCookie(true)`), and `FLAG_KEEP_SCREEN_ON`.
- **Home-row icon:** the manifest needs:
  - `uses-feature android.software.leanback` (required=false) and `android.hardware.touchscreen` (required=false);
  - a `MAIN` + `LEANBACK_LAUNCHER` intent-filter;
  - `android:banner`, a 320×180 image.
- **Remote keys:** D-pad and OK arrive as normal `keydown` events (ArrowUp/Down/Left/Right, Enter). Back does **not** reach the page: override the back callback in the activity and forward it into the page. Keep the WebView focused.
- **Chromium version:** WebView updates through the Play Store. The exact version on Google TV is unknown, so log `navigator.userAgent` on first run.

## Keeping the page running in the background
- **Never call `webView.onPause()` / `pauseTimers()`.** The page then keeps running its timers and fetches. According to the Chromium team, `visibilityState` only becomes `hidden` when the WebView is paused. Community reports conflict on this, so **test on device**.
- **Real risk: Android kills cached background processes.** Use a **foreground service** to prevent that.
  - Android 14 requires the service to declare a type. Use `specialUse`: `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_SPECIAL_USE` + property `android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE`. Avoid `dataSync`, which has time limits on Android 15.
  - Start the service while the activity is in front.
  - It needs a notification channel. Grant `POST_NOTIFICATIONS` with `adb shell pm grant`.
- **Fallback if the activity gets destroyed:** have the service own the WebView, and attach that WebView to the activity whenever the activity is showing.
- **How to verify:**
  - `adb shell dumpsys activity processes` should show the process as a foreground service, not cached.
  - The page's timers should still be ticking after 10+ minutes in another app.

## Telling whether another app is playing audio
- `AudioManager.isMusicActive()` is true for any app, Spotify included. Combine it with Spotify's `is_playing`: music active while Spotify is not playing ⇒ another app.
- `getActivePlaybackConfigurations()` hides which app each stream belongs to, so it's useless for telling apps apart.
- **Exact package names** are possible with `MediaSessionManager.getActiveSessions` + a NotificationListenerService, granted via `adb shell cmd notification allow_listener <pkg>/<cls>`. Whether that grant works on Google TV is unknown; **test on device**.

## Bringing Stacker to the front
- Android allows an app to start an activity from the background if the user granted `SYSTEM_ALERT_WINDOW` ("display over other apps"). Grant it with `adb shell appops set <pkg> SYSTEM_ALERT_WINDOW allow`. Whether Google TV honours it is unknown; **test on device**.
- Then call `startActivity` with `NEW_TASK | REORDER_TO_FRONT`.
- Fallback: `moveTaskToFront` with the `REORDER_TASKS` permission.
- Full-screen-intent notifications are unlikely to work on a TV.

## Spotify sign-in inside the WebView
- Email/password login works in a WebView; Spotify's own Android SDK uses that path.
- Google sign-in is blocked in WebViews (`403 disallowed_useragent`). Eric uses email/password, so this doesn't affect us.
- Keep every navigation inside the WebView. The redirect to `https://heydenberk.com/stacker/?code=…` is an ordinary navigation and needs no special handling.

## Building the app in GitHub Actions
- Use AGP 8.13.x with Gradle 8.13+, JDK 17, Kotlin 2.x, compileSdk 35, targetSdk 34. Avoid AGP 9.
- The `ubuntu-latest` runner already has the Android SDK. Steps: setup-java 17 → setup-gradle → `assembleDebug` → upload-artifact.
- The debug signing key is fine for sideloading.
- **Gradle wrapper:** generate it in CI (`gradle wrapper` with setup-gradle `gradle-version`), or commit the wrapper files.
- **Minimal file set:**
  - `settings.gradle.kts` and the root `build.gradle.kts`
  - `gradle.properties`
  - `app/build.gradle.kts`
  - `AndroidManifest.xml`
  - `MainActivity.kt` and the service
  - the banner and icon images

## Installing on the TV from the Mac
- `brew install --cask android-platform-tools` provides `adb`.
- **On the TV:**
  - Settings → System → About → tap "Android TV OS Build" 7× to unlock Developer options.
  - Developer options → Wireless debugging. On Android 14 over Wi‑Fi this is required.
  - "Pair device with pairing code" shows a pairing address and code.
- **On the Mac:**
  - `adb pair <ip>:<pairport>`, then `adb connect <ip>:<port>`. The connect port is a different one, shown on the Wireless debugging screen.
  - `adb install -r app-debug.apk`, then the `appops` / `pm grant` commands above.
- The port changes when Wireless debugging is toggled, so script the install.

## GitHub Pages deploy
- Vite `base: '/stacker/'`.
- Workflow: checkout → setup-node → `npm ci && npm run build` with env `SPOTIFY_CLIENT_ID: ${{ vars.SPOTIFY_CLIENT_ID }}` (our `vite.config.ts` reads `SPOTIFY_CLIENT_ID` through `loadEnv`, so it doesn't need a `VITE_` prefix) → configure-pages → upload-pages-artifact (`dist`) → deploy-pages.
- Workflow permissions: `pages: write`, `id-token: write`.
- Pin the action versions to their latest majors.
- In the repo's Settings → Pages, set the source to "GitHub Actions". The custom domain carries over from `heydenberk.github.io`.
- Register `https://heydenberk.com/stacker/` as a Spotify redirect URI. It must match exactly, including the trailing slash.
