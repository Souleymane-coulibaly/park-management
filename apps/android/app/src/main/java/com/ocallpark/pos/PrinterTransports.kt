package com.ocallpark.pos

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbManager
import android.os.Build
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

/** Erreur matérielle normalisée, renvoyée telle quelle à l'application web. */
class HardwareException(val code: String, message: String) : Exception(message)

/** Envoi d'octets ESC/POS à une imprimante, indépendamment du fabricant et de la connexion. */
interface PrinterTransport {
    @Throws(HardwareException::class)
    fun send(bytes: ByteArray)
}

/** Imprimante réseau (Ethernet / Wi-Fi), impression brute sur le port 9100. */
class NetworkTransport(private val address: String) : PrinterTransport {
    override fun send(bytes: ByteArray) {
        val host = address.substringBefore(':')
        val port = address.substringAfter(':', "9100").toInt()
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), 5_000)
                socket.soTimeout = 5_000
                socket.getOutputStream().apply { write(bytes); flush() }
            }
        } catch (e: IOException) {
            throw HardwareException("PRINTER_UNREACHABLE", "Imprimante réseau injoignable ($address).")
        }
    }
}

/** Imprimante Bluetooth classique (profil série SPP), préalablement appairée dans Android. */
class BluetoothTransport(private val context: Context, private val address: String) : PrinterTransport {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    override fun send(bytes: ByteArray) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            throw HardwareException("PERMISSION_DENIED", "Autorisez Bluetooth pour l'application Ocall Park.")
        }
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            ?: throw HardwareException("BLUETOOTH_UNAVAILABLE", "Bluetooth indisponible sur cet appareil.")
        if (!adapter.isEnabled) throw HardwareException("BLUETOOTH_DISABLED", "Activez le Bluetooth.")
        try {
            adapter.getRemoteDevice(address.uppercase()).createRfcommSocketToServiceRecord(spp).use { socket ->
                adapter.cancelDiscovery()
                socket.connect()
                socket.outputStream.apply { write(bytes); flush() }
            }
        } catch (e: IOException) {
            throw HardwareException("PRINTER_UNREACHABLE", "Imprimante Bluetooth injoignable ($address).")
        } catch (e: SecurityException) {
            throw HardwareException("PERMISSION_DENIED", "Autorisation Bluetooth refusée.")
        }
    }
}

/** Imprimante USB (câble OTG) : transfert « bulk » vers le point de sortie de l'interface imprimante. */
class UsbTransport(private val context: Context, private val address: String) : PrinterTransport {
    override fun send(bytes: ByteArray) {
        val (vendorId, productId) = address.split(":").map { it.toInt(16) }
        val manager = context.getSystemService(UsbManager::class.java)
            ?: throw HardwareException("USB_UNAVAILABLE", "USB hôte indisponible sur cet appareil.")
        val device = manager.deviceList.values.firstOrNull { it.vendorId == vendorId && it.productId == productId }
            ?: throw HardwareException("PRINTER_UNREACHABLE", "Imprimante USB non branchée ($address).")
        if (!manager.hasPermission(device)) {
            UsbPermission.request(context, manager, device)
            throw HardwareException("PERMISSION_DENIED", "Autorisez l'accès à l'imprimante USB, puis réessayez.")
        }
        val iface = (0 until device.interfaceCount).map(device::getInterface).firstOrNull { it.interfaceClass == UsbConstants.USB_CLASS_PRINTER }
            ?: device.getInterface(0)
        val endpoint = (0 until iface.endpointCount).map(iface::getEndpoint)
            .firstOrNull { it.type == UsbConstants.USB_ENDPOINT_XFER_BULK && it.direction == UsbConstants.USB_DIR_OUT }
            ?: throw HardwareException("PRINTER_UNSUPPORTED", "Interface d'impression USB introuvable.")
        val connection = manager.openDevice(device) ?: throw HardwareException("PRINTER_UNREACHABLE", "Ouverture USB impossible.")
        try {
            if (!connection.claimInterface(iface, true)) throw HardwareException("PRINTER_BUSY", "Imprimante USB occupée.")
            var offset = 0
            while (offset < bytes.size) {
                val chunk = minOf(endpoint.maxPacketSize.coerceAtLeast(64) * 16, bytes.size - offset)
                val sent = connection.bulkTransfer(endpoint, bytes, offset, chunk, 5_000)
                if (sent <= 0) throw HardwareException("PRINTER_UNREACHABLE", "Transfert USB interrompu.")
                offset += sent
            }
        } finally {
            connection.releaseInterface(iface)
            connection.close()
        }
    }
}

fun transportFor(context: Context, target: CommandValidator.Target): PrinterTransport = when (target.connection) {
    "NETWORK" -> NetworkTransport(target.address)
    "BLUETOOTH" -> BluetoothTransport(context, target.address)
    "USB" -> UsbTransport(context, target.address)
    else -> throw HardwareException("INVALID_COMMAND", "Connexion inconnue.")
}
