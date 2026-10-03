package com.heydenberk.stacker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * A `specialUse` foreground service whose only job is to keep the process (and so the WebView in
 * [MainActivity]) from being reclaimed while other apps are in front.
 */
class KeepAliveService : Service() {

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.keepalive_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            // Before API 34 the type comes from the manifest.
            startForeground(NOTIFICATION_ID, notification)
        }
        // If the process dies, the WebView dies with it; a restarted service alone keeps nothing alive.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent): IBinder? = null

    private fun buildNotification(): Notification {
        val openApp = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            openApp,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.keepalive_notification_title))
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build()
    }

    private companion object {
        const val CHANNEL_ID = "keepalive"
        const val NOTIFICATION_ID = 1
    }
}
