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
 * Deliberately NOT OkHttp's CertificatePinner (that pins leaf SPKI). Chain
 * signature and expiry ARE verified (the CA cert is public, so the pin alone
 * would not stop a MITM appending the real CA behind their own leaf); only
 * hostname verification is disabled — the SAN covers only 127.0.0.1, so it
 * would always fail on LAN IPs. Do not "fix" this with strict verification.
 */
class RootCaTrustManager(private val pinHex: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val root = chain.lastOrNull() ?: throw CertificateException("empty chain")
        val hex = FingerprintPin.sha256Hex(root.encoded)
        if (!hex.equals(pinHex, ignoreCase = true)) {
            throw CertificateException("CA fingerprint mismatch")
        }
        // 指纹只证明「链尾是那本 CA」，不证明叶子由它签发 —— daemon 公开
        // 呈现 CA 证书，MITM 可以把真 CA 附在自己叶子的链尾绕过纯指纹比较。
        // 所以再验两步：叶子确实由这本 CA 签发 + 两者都在有效期内。
        // hostname 仍不验（SAN 只覆盖 127.0.0.1，LAN IP 必然不匹配）。
        val leaf = chain.first()
        try {
            leaf.checkValidity()
            root.checkValidity()
            if (chain.size > 1) leaf.verify(root.publicKey)
        } catch (e: CertificateException) {
            throw e
        } catch (e: Exception) {
            throw CertificateException("leaf not signed by pinned CA", e)
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
