package io.quotawatch

import io.quotawatch.net.FingerprintPin
import io.quotawatch.net.PinnedHttpClients
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.net.ssl.SSLHandshakeException

/**
 * Real-TLS pinning tests against a local HTTPS server: the server presents
 * [leaf, CA] exactly like the daemon (api-server.ts concatenates leaf+CA).
 */
class PinnedTrustManagerTest {
    private val server = MockWebServer()

    private val ca = HeldCertificate.Builder()
        .certificateAuthority(0)
        .commonName("quota-watch local CA")
        .build()
    private val leaf = HeldCertificate.Builder()
        .signedBy(ca)
        .commonName("quota-watch local")
        .build()
    private val caPin = FingerprintPin.sha256Hex(ca.certificate.encoded)

    private fun startServer() {
        val serverCerts = HandshakeCertificates.Builder()
            .heldCertificate(leaf, ca.certificate) // present leaf + CA, like the daemon
            .build()
        server.useHttps(serverCerts.sslSocketFactory(), false)
        server.start()
    }

    @After fun tearDown() = server.shutdown()

    private fun get(pinHex: String): Int {
        val client = PinnedHttpClients.client(pinHex, 5)
        val req = Request.Builder().url("https://localhost:${server.port}/health").build()
        client.newCall(req).execute().use { return it.code }
    }

    @Test fun `pin matching the CA succeeds`() {
        startServer()
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, get(caPin))
    }

    @Test fun `pin for a different CA is rejected`() {
        startServer()
        val otherCa = HeldCertificate.Builder().certificateAuthority(0).build()
        val wrongPin = FingerprintPin.sha256Hex(otherCa.certificate.encoded)
        val e = assertThrows(SSLHandshakeException::class.java) { get(wrongPin) }
        assertTrue(e.message.orEmpty().contains("fingerprint", ignoreCase = true) ||
            e.cause?.message.orEmpty().contains("fingerprint", ignoreCase = true))
    }

    @Test fun `hostname mismatch is tolerated — the pin is the trust decision`() {
        startServer()
        server.enqueue(MockResponse().setBody("{}"))
        // The cert's CN is "quota-watch local" and we dial "localhost" — stock
        // hostname verification would fail; the permissive verifier must not.
        val client = PinnedHttpClients.client(caPin, 5)
        val req = Request.Builder().url("https://127.0.0.1:${server.port}/health").build()
        client.newCall(req).execute().use { assertEquals(200, it.code) }
    }
}
