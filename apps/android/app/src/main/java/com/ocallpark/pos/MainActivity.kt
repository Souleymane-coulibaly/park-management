package com.ocallpark.pos

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Connecteur Ocall Park pour tablette Android : une WebView qui charge l'application web
 * (BuildConfig.APP_URL) et lui expose un pont matériel limité (imprimante, tiroir-caisse).
 *
 * Sécurité :
 * - le pont n'est injecté que pour l'origine BuildConfig.ALLOWED_ORIGIN (HTTPS), via
 *   WebViewCompat.addWebMessageListener — aucune autre page ne peut l'appeler ;
 * - la WebView ne navigue que sur cette origine ; tout autre lien s'ouvre dans le navigateur ;
 * - aucun accès aux fichiers, pas de contenu mixte, pas de trafic en clair.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var bridge: HardwareBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = request.url
                if (originOf(target) == BuildConfig.ALLOWED_ORIGIN) return false
                startActivity(Intent(Intent.ACTION_VIEW, target))
                return true
            }
        }

        bridge = HardwareBridge(this)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "OcallHardware", setOf(BuildConfig.ALLOWED_ORIGIN), bridge)
        } else {
            // WebView trop ancienne : la caisse fonctionne, sans impression ni tiroir.
            Toast.makeText(this, "Mettez à jour Android System WebView pour activer l'imprimante.", Toast.LENGTH_LONG).show()
        }

        // Android 12+ : l'accès aux imprimantes Bluetooth nécessite une autorisation explicite.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), 1)
        }

        if (savedInstanceState == null) webView.loadUrl(BuildConfig.APP_URL) else webView.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    @Deprecated("Navigation arrière gérée par la WebView")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        bridge.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    private fun originOf(uri: Uri): String =
        if (uri.port == -1) "${uri.scheme}://${uri.host}" else "${uri.scheme}://${uri.host}:${uri.port}"
}
