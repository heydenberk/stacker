package com.heydenberk.stacker

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import org.json.JSONObject

/**
 * Exposed to the page as `window.StackerShell`.
 *
 * `@JavascriptInterface` methods run on a WebView binder thread, not the main thread, so anything
 * that touches the UI is posted to the main looper. Construct this on the main thread.
 */
class ShellBridge(private val activity: Activity) {

    private val appContext: Context = activity.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val mainHandler = Handler(Looper.getMainLooper())

    // Read once on the main thread rather than from the binder thread.
    private val defaultUserAgent: String = WebSettings.getDefaultUserAgent(appContext)

    /**
     * True when any app is playing music-stream audio, Spotify included.
     *
     * Android won't say which app is playing, so this cannot distinguish Spotify from anything
     * else. The web side combines it with Spotify's own `is_playing`: music active while Spotify
     * reports not playing means another app has the speakers.
     */
    @JavascriptInterface
    fun isOtherAudioPlaying(): Boolean = audioManager.isMusicActive

    /**
     * Brings the Stacker activity back in front of whatever app is showing.
     *
     * Starting an activity from the background is only allowed because the user granted
     * "display over other apps" (SYSTEM_ALERT_WINDOW, via `adb shell appops`). If the start throws,
     * fall back to `moveTaskToFront`, which uses the REORDER_TASKS permission.
     */
    @JavascriptInterface
    fun bringToFront() {
        mainHandler.post {
            try {
                val intent = Intent(activity, MainActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                )
                activity.startActivity(intent)
            } catch (e: Exception) {
                Log.w(TAG, "startActivity failed; falling back to moveTaskToFront", e)
                try {
                    val activityManager =
                        appContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                    activityManager.moveTaskToFront(activity.taskId, 0)
                } catch (e2: Exception) {
                    Log.w(TAG, "moveTaskToFront failed", e2)
                }
            }
        }
    }

    /** Device and permission details as JSON, for the debug page. */
    @JavascriptInterface
    fun info(): String {
        val json = JSONObject()
        json.put("model", Build.MODEL)
        json.put("sdk", Build.VERSION.SDK_INT)
        json.put("userAgent", defaultUserAgent)
        json.put("overlayAllowed", Settings.canDrawOverlays(appContext))
        return json.toString()
    }

    private companion object {
        const val TAG = "StackerShell"
    }
}
