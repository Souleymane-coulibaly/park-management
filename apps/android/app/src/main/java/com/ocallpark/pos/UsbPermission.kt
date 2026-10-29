package com.ocallpark.pos

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager

/** Demande d'autorisation d'accès à une imprimante USB (boîte de dialogue système Android). */
object UsbPermission {
    private const val ACTION = "com.ocallpark.pos.USB_PERMISSION"

    fun request(context: Context, manager: UsbManager, device: UsbDevice) {
        val intent = PendingIntent.getBroadcast(
            context,
            0,
            Intent(ACTION).setPackage(context.packageName),
            PendingIntent.FLAG_IMMUTABLE,
        )
        manager.requestPermission(device, intent)
    }
}
