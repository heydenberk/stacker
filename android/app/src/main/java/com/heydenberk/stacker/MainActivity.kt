package com.heydenberk.stacker

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Full-screen WebView host for the Stacker web app.
 *
 * The WebView is deliberately never paused (no `onPause()` / `pauseTimers()`), so the page keeps
 * polling Spotify while other apps are in front. [KeepAliveService] keeps the process from being
 * reclaimed while it is in the background.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    @Suppress("DEPRECATION") // WebSettings.databaseEnabled
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        startForegroundService(Intent(this, KeepAliveService::class.java))

        // Lets chrome://inspect attach over adb.
        WebView.setWebContentsDebuggingEnabled(true)

        val view = WebView(this)
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.databaseEnabled = true
        view.settings.mediaPlaybackRequiresUserGesture = false
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.webViewClient = ShellWebViewClient()
        view.addJavascriptInterface(ShellBridge(this), BRIDGE_NAME)

        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(view, true)

        webView = view
        setContentView(view)
        view.loadUrl(intent.getStringExtra(EXTRA_URL) ?: BuildConfig.STACKER_URL)
        view.requestFocus()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = intent.getStringExtra(EXTRA_URL)
        if (url != null) {
            webView.loadUrl(url)
        }
        webView.requestFocus()
    }

    /**
     * The remote's Back key never reaches the page, so intercept it before the view hierarchy and
     * ask the page first. Consume both key-down and key-up and act once, on key-up.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) {
                handleBack()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun handleBack() {
        webView.evaluateJavascript(BACK_SCRIPT) { result ->
            // evaluateJavascript hands back the JSON encoding, so the string "true" arrives
            // as "\"true\"". Accept the bare form too, in case the page returns a boolean.
            val handled = result == "\"true\"" || result == "true"
            if (!handled) {
                // Leaves the activity (and the page) running; it is just no longer in front.
                moveTaskToBack(true)
            }
        }
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface(BRIDGE_NAME)
        webView.destroy()
        stopService(Intent(this, KeepAliveService::class.java))
        super.onDestroy()
    }

    /** Keeps every http(s) navigation (including the Spotify sign-in redirect) inside the WebView. */
    private class ShellWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val scheme = request?.url?.scheme ?: return false
            // Swallow other schemes (intent:, spotify:, ...) rather than showing an error page.
            return scheme != "http" && scheme != "https"
        }
    }

    companion object {
        const val EXTRA_URL = "url"
        private const val BRIDGE_NAME = "StackerShell"
        private const val BACK_SCRIPT =
            "(function(){try{return window.stackerBack?String(window.stackerBack()):'false'}" +
                "catch(e){return 'false'}})()"
    }
}
