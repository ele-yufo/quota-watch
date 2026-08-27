package io.quotawatch

import io.quotawatch.data.WindowKind
import io.quotawatch.net.ApiClient
import io.quotawatch.net.ApiError
import io.quotawatch.net.FingerprintPin
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Wire-contract tests against a mock daemon speaking real HTTPS. */
class ApiClientContractTest {
    private val server = MockWebServer()

    private val ca = HeldCertificate.Builder().certificateAuthority(0).commonName("ca").build()
    private val leaf = HeldCertificate.Builder().signedBy(ca).commonName("leaf").build()
    private val caPin = FingerprintPin.sha256Hex(ca.certificate.encoded)

    private fun startServer() {
        val certs = HandshakeCertificates.Builder().heldCertificate(leaf, ca.certificate).build()
        server.useHttps(certs.sslSocketFactory(), false)
        server.start()
    }

    @After fun tearDown() = server.shutdown()

    private fun client(token: String? = "tok") =
        ApiClient("localhost", server.port, token, caPin, timeoutSeconds = 5)

    private fun quotaJson() = """[
      {"providerId":"claude-main","displayName":"Claude Max","providerType":"claude","windows":[
        {"windowName":"session (5h)","windowKind":"session","used":42.0,"total":100.0,
         "unit":"percent","remainingPct":58.0,"resetAt":"2026-08-28T08:00:00.000Z",
         "timestamp":"2026-08-28T03:20:00.456Z"},
        {"windowName":"mystery","windowKind":"fortnight","used":1.0,"total":2.0,
         "unit":"tokens","remainingPct":50.0,"resetAt":null,
         "timestamp":"2026-08-28T03:20:00.456Z"}
      ]}
    ]"""

    @Test fun `quota decodes a bare array including unknown kinds`() = runTest {
        startServer()
        server.enqueue(MockResponse().setBody(quotaJson()))
        val providers = client().quota()
        assertEquals(1, providers.size)
        assertEquals("claude-main", providers[0].providerId)
        assertEquals(WindowKind.SESSION, providers[0].windows[0].windowKind)
        assertEquals(WindowKind.UNKNOWN, providers[0].windows[1].windowKind)
        assertNull(providers[0].windows[1].resetAt)

        val recorded = server.takeRequest()
        assertEquals("Bearer tok", recorded.getHeader("Authorization"))
        assertEquals("GET", recorded.method)
    }

    @Test fun `claim sends exact body and no auth header`() = runTest {
        startServer()
        server.enqueue(MockResponse().setBody(
            """{"ok":true,"token":"0123456789abcdef0123456789abcdef","port":3737,"caFingerprint":"$caPin"}"""))
        val (token, fp) = client(token = null).claimPairingCode("012345")
        assertEquals("0123456789abcdef0123456789abcdef", token)
        assertEquals(caPin, fp)

        val recorded = server.takeRequest()
        assertEquals("""{"code":"012345"}""", recorded.body.readUtf8())
        assertNull(recorded.getHeader("Authorization"))
        assertEquals("POST", recorded.method)
    }

    @Test fun `claim 401 maps to unauthorized`() = runTest {
        startServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody(
            """{"ok":false,"error":"invalid code"}"""))
        try {
            client(token = null).claimPairingCode("999999")
            fail("expected ApiException")
        } catch (e: ApiClient.ApiException) {
            assertTrue(e.error is ApiError.Unauthorized)
        }
    }

    @Test fun `claim 200 with ok false maps to unauthorized`() = runTest {
        startServer()
        server.enqueue(MockResponse().setBody("""{"ok":false,"error":"code expired"}"""))
        try {
            client(token = null).claimPairingCode("111111")
            fail("expected ApiException")
        } catch (e: ApiClient.ApiException) {
            assertTrue(e.error is ApiError.Unauthorized)
        }
    }

    @Test fun `health tolerates extra keys`() = runTest {
        startServer()
        server.enqueue(MockResponse().setBody(
            """{"status":"ok","pid":1,"version":"dev","startedAt":"2026-08-28T00:00:00.000Z",
               "uptimeSec":42,"providers":[],"futureField":{"nested":true}}"""))
        val h = client().health()
        assertEquals("ok", h.status)
        assertEquals(42, h.uptimeSec)
    }

    @Test fun `no fingerprint configured refuses before any network`() = runTest {
        startServer()
        try {
            ApiClient("localhost", server.port, "tok", null).quota()
            fail("expected ApiException")
        } catch (e: ApiClient.ApiException) {
            assertTrue(e.error is ApiError.NotConfigured)
        }
        assertEquals(0, server.requestCount)
    }
}
