package com.ocallpark.pos

import android.util.Base64

/**
 * Validation des commandes reçues du pont — miroir de
 * packages/shared/src/hardware/bridge-protocol.ts (mêmes règles côté web et côté natif).
 */
object CommandValidator {
    const val MAX_PRINT_BYTES = 64 * 1024
    private const val PORT_MIN = 9100
    private const val PORT_MAX = 9109
    private val MAC = Regex("^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
    private val USB = Regex("^[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}$")

    data class Target(val connection: String, val address: String)

    sealed class Result {
        data class Ok(val bytes: ByteArray? = null) : Result()
        data class Invalid(val message: String) : Result()
    }

    /** Imprimante réseau : IPv4 privée uniquement, port d'impression brute 9100–9109. */
    fun validateTarget(target: Target): String? = when (target.connection) {
        "NETWORK" -> {
            val parts = target.address.split(":")
            val host = parts[0]
            val port = parts.getOrNull(1)
            when {
                parts.size > 2 || !isPrivateIpv4(host) -> "Adresse réseau invalide."
                port != null && (port.toIntOrNull() ?: -1) !in PORT_MIN..PORT_MAX -> "Port invalide."
                else -> null
            }
        }
        "BLUETOOTH" -> if (MAC.matches(target.address)) null else "Adresse Bluetooth invalide."
        "USB" -> if (USB.matches(target.address)) null else "Identifiant USB invalide."
        else -> "Connexion inconnue."
    }

    fun isPrivateIpv4(host: String): Boolean {
        val parts = host.split(".")
        if (parts.size != 4) return false
        val n = parts.map { p -> if (p.length in 1..3 && p.all(Char::isDigit)) p.toInt() else return false }
        if (n.any { it > 255 }) return false
        return n[0] == 10 || (n[0] == 172 && n[1] in 16..31) || (n[0] == 192 && n[1] == 168)
    }

    /** Flux d'impression : base64 valide, taille bornée, sans séquence d'ouverture de tiroir. */
    fun decodePrintData(data: String): Result {
        val bytes = try {
            Base64.decode(data, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            return Result.Invalid("Flux d'impression illisible.")
        }
        if (bytes.isEmpty() || bytes.size > MAX_PRINT_BYTES) return Result.Invalid("Taille du flux d'impression invalide.")
        if (containsDrawerKick(bytes)) return Result.Invalid("Un flux d'impression ne peut pas ouvrir le tiroir.")
        return Result.Ok(bytes)
    }

    fun containsDrawerKick(bytes: ByteArray): Boolean {
        for (i in 0 until bytes.size - 1) {
            val a = bytes[i].toInt() and 0xff
            val b = bytes[i + 1].toInt() and 0xff
            if ((a == 0x1b && b == 0x70) || (a == 0x10 && b == 0x14)) return true
        }
        return false
    }
}
