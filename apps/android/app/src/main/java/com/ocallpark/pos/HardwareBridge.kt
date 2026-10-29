package com.ocallpark.pos

import android.content.Context
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Pont matériel exposé à l'application web sous le nom `OcallHardware`.
 *
 * N'accepte que quatre commandes : `info`, `print`, `test`, `openDrawer`. La commande d'ouverture
 * du tiroir est générée ici (jamais transmise par la page), un flux `print` qui contiendrait une
 * séquence d'ouverture est refusé, et deux ouvertures sont espacées d'au moins 3 secondes.
 * L'autorisation métier (qui peut ouvrir, quand) est décidée par le serveur Ocall Park.
 */
class HardwareBridge(private val context: Context) : WebViewCompat.WebMessageListener {
    private val executor = Executors.newSingleThreadExecutor()
    @Volatile private var lastDrawerOpening = 0L

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        // Défense en profondeur : l'origine est déjà filtrée par addWebMessageListener.
        if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != BuildConfig.ALLOWED_ORIGIN) return
        val raw = message.data ?: return
        val request = try {
            JSONObject(raw)
        } catch (e: Exception) {
            return
        }
        val id = request.optString("id")
        if (id.isEmpty() || id.length > 64) return

        executor.execute {
            val response = try {
                handle(request)
                JSONObject().put("id", id).put("ok", true)
            } catch (e: HardwareException) {
                JSONObject().put("id", id).put("ok", false).put("error", e.code).put("message", e.message)
            } catch (e: Exception) {
                JSONObject().put("id", id).put("ok", false).put("error", "HARDWARE_ERROR").put("message", "Erreur inattendue du connecteur.")
            }
            view.post { replyProxy.postMessage(response.toString()) }
        }
    }

    private fun handle(request: JSONObject) {
        when (request.optString("type")) {
            "info" -> Unit
            "print" -> {
                val target = target(request)
                val bytes = when (val result = CommandValidator.decodePrintData(request.optString("data"))) {
                    is CommandValidator.Result.Ok -> result.bytes!!
                    is CommandValidator.Result.Invalid -> throw HardwareException("INVALID_COMMAND", result.message)
                }
                transportFor(context, target).send(bytes)
            }
            "test" -> transportFor(context, target(request)).send(EscPos.testPage())
            "openDrawer" -> {
                val target = target(request)
                val pin = request.optInt("pin", 2)
                if (pin != 2 && pin != 5) throw HardwareException("INVALID_COMMAND", "Broche de tiroir invalide.")
                val now = System.currentTimeMillis()
                if (now - lastDrawerOpening < 3_000) throw HardwareException("DRAWER_COOLDOWN", "Ouverture trop rapprochée.")
                transportFor(context, target).send(EscPos.drawerKick(pin))
                lastDrawerOpening = now
            }
            else -> throw HardwareException("INVALID_COMMAND", "Commande inconnue.")
        }
    }

    private fun target(request: JSONObject): CommandValidator.Target {
        val printer = request.optJSONObject("printer") ?: throw HardwareException("INVALID_COMMAND", "Imprimante manquante.")
        val target = CommandValidator.Target(printer.optString("connection"), printer.optString("address"))
        CommandValidator.validateTarget(target)?.let { throw HardwareException("INVALID_COMMAND", it) }
        return target
    }

    fun shutdown() = executor.shutdownNow()
}

/** Commandes ESC/POS générées par le connecteur lui-même. */
object EscPos {
    /** ESC p m t1 t2 : impulsion sur la broche 2 (m = 0) ou 5 (m = 1), 50 ms / 500 ms. */
    fun drawerKick(pin: Int): ByteArray = byteArrayOf(0x1b, 0x70, if (pin == 5) 1 else 0, 25, 250.toByte())

    fun testPage(): ByteArray {
        val text = "Ocall Park\nTest du connecteur Android\nImprimante OK\n\n\n\n"
        return byteArrayOf(0x1b, 0x40) + text.toByteArray(Charsets.US_ASCII) + byteArrayOf(0x1d, 0x56, 0x42, 0x00)
    }
}
