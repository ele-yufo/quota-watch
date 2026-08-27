package io.quotawatch.net

import okhttp3.OkHttpClient
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Pins the daemon's local CA by fingerprint: SHA-256 over the DER of the ROOT
 * certificate of the presented chain, compared to the stored hex. The daemon
 * presents leaf+CA concatenated (api-server.ts), so chain.last() is the CA.
 *
 * Deliberately NOT OkHttp's CertificatePinner (that pins leaf SPKI), and NOT
 * chain building/expiry/hostname checks — the pin is the entire trust decision
 * (same semantics as iOS PinningDelegate). The SAN covers only 127.0.0.1, so
 * hostname verification would always fail on LAN IPs; it is disabled on
 * purpose. Do not "fix" this with strict verification.
 */
class RootCaTrustManager(private val pinHex: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val root = chain.lastOrNull() ?: throw CertificateException("empty chain")
        val hex = FingerprintPin.sha256Hex(root.encoded)
        if (!hex.equals(pinHex, ignoreCase = true)) {
            throw CertificateException("CA fingerprint mismatch")
        }
    }

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("client auth not supported")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

object PinnedHttpClients {
    private val cache = ConcurrentHashMap<String, OkHttpClient>()

    /** One client per fingerprint (mirrors iOS pinSessions). */
    fun client(pinHex: String, timeoutSeconds: Long = 8): OkHttpClient =
        cache.getOrPut("$pinHex:$timeoutSeconds") {
            val tm = RootCaTrustManager(pinHex)
            val ssl = SSLContext.getInstance("TLS")
            ssl.init(null, arrayOf(tm), java.security.SecureRandom())
            OkHttpClient.Builder()
                .sslSocketFactory(ssl.socketFactory, tm)
                .hostnameVerifier { _, _ -> true } // see class docs — pin is the trust
                .connectTimeout(timeoutSeconds, TimeUnit.SECONDS)
                .readTimeout(timeoutSeconds, TimeUnit.SECONDS)
                .writeTimeout(timeoutSeconds, TimeUnit.SECONDS)
                .build()
        }
}
